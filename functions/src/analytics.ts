import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

// Writes to venues/{venueId}/analyticsEvents — stream this collection to BigQuery
// using the Firebase Firestore BigQuery Export extension:
//   firebase ext:install firebase/firestore-bigquery-export
// Point it at: venues/{venueId}/analyticsEvents (wildcard collection group)

// ── Stocktake area completed ─────────────────────────────────────────────────
// Fires when completedAt is first set on a department area document.
export const onStocktakeCompleted = functions
  .region("us-central1")
  .firestore.document("venues/{venueId}/departments/{departmentId}/areas/{areaId}")
  .onUpdate(async (change, ctx) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;

    // Only fire when completedAt transitions from absent to set
    if (before.completedAt || !after.completedAt) return;

    const { venueId, departmentId, areaId } = ctx.params as Record<string, string>;
    const db = admin.firestore();

    let durationMinutes: number | null = null;
    if (after.startedAt && after.completedAt) {
      try {
        const startMs = after.startedAt.toMillis ? after.startedAt.toMillis() : after.startedAt._seconds * 1000;
        const endMs = after.completedAt.toMillis ? after.completedAt.toMillis() : after.completedAt._seconds * 1000;
        durationMinutes = Math.round((endMs - startMs) / 60000);
      } catch {}
    }

    let itemCount = 0;
    try {
      const snap = await db
        .collection(`venues/${venueId}/departments/${departmentId}/areas/${areaId}/items`)
        .get();
      itemCount = snap.size;
    } catch {}

    await db.collection(`venues/${venueId}/analyticsEvents`).add({
      type: "stocktake_area_completed",
      venueId,
      departmentId,
      areaId,
      itemCount,
      durationMinutes,
      completedAt: after.completedAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("[analytics/onStocktakeCompleted]", { venueId, areaId, itemCount, durationMinutes });
  });

// ── Order submitted ──────────────────────────────────────────────────────────
// Fires when an order's status transitions to 'submitted'.
export const onOrderSubmitted = functions
  .region("us-central1")
  .firestore.document("venues/{venueId}/orders/{orderId}")
  .onUpdate(async (change, ctx) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;

    if (before.status === "submitted" || after.status !== "submitted") return;

    const { venueId, orderId } = ctx.params as Record<string, string>;
    const db = admin.firestore();

    let lineCount = 0;
    try {
      const snap = await db.collection(`venues/${venueId}/orders/${orderId}/lines`).get();
      lineCount = snap.size;
    } catch {}

    await db.collection(`venues/${venueId}/analyticsEvents`).add({
      type: "order_submitted",
      venueId,
      orderId,
      supplierId: after.supplierId ?? null,
      lineCount,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("[analytics/onOrderSubmitted]", { venueId, orderId, lineCount });
  });

// ── AI feature used ──────────────────────────────────────────────────────────
// Fires when aiUsage is updated (server writes this in trackAiCall in api.ts).
// Detects which feature changed in the breakdown map and emits one event per use.
export const onAiFeatureUsed = functions
  .region("us-central1")
  .firestore.document("venues/{venueId}/aiUsage/{monthKey}")
  .onWrite(async (change, ctx) => {
    if (!change.after.exists) return;

    const before = (change.before.exists ? change.before.data() : {}) as any;
    const after = change.after.data() as any;
    const { venueId } = ctx.params as { venueId: string };

    const beforeBreakdown: Record<string, number> = before.breakdown ?? {};
    const afterBreakdown: Record<string, number> = after.breakdown ?? {};

    const db = admin.firestore();
    const batch = db.batch();

    for (const feature of Object.keys(afterBreakdown)) {
      const prev = beforeBreakdown[feature] ?? 0;
      const curr = afterBreakdown[feature] ?? 0;
      if (curr > prev) {
        const ref = db.collection(`venues/${venueId}/analyticsEvents`).doc();
        batch.set(ref, {
          type: "ai_feature_used",
          feature,
          venueId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    await batch.commit();
  });
