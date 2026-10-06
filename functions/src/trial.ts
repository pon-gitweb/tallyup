import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

const REGION = "australia-southeast1";

export const FOUNDER_UIDS: ReadonlySet<string> = new Set([
  "ChpWVbutHwSCRQKr3THR79EIw1X2", // Poni (account 1)
  "nIIcWSEbb2QjkKlwrALBUFXIXtu2", // Poni (account 2)
  "DyydVaTSaPN5MWrLyHczVeZbzDv2", // Izzy (account 1)
  "XdxYqrCUeQYvfHkJkptjOoXDEwl2", // Chris (account 1)
  "OIvPVgL6FpN960FMqTybe7aMRZG3", // Chris (account 2)
  "WXQtR9QUsCShHtmKzopGEwiQYLV2", // Shayle (account 1)
]);

// ── Pure decision functions (exported for unit tests) ────────────────────────

export function shouldStartTrial({
  venueCreatedAt,
  pilotTriggerDate,
  ownerUid,
  legacyFreeAccess,
  founderUids,
}: {
  venueCreatedAt: Date | null;
  pilotTriggerDate: Date | null;
  ownerUid: string;
  legacyFreeAccess: boolean | null | undefined;
  founderUids: ReadonlySet<string>;
}): boolean {
  if (!pilotTriggerDate || !venueCreatedAt) return false;
  if (venueCreatedAt < pilotTriggerDate) return false;
  if (founderUids.has(ownerUid)) return false;
  if (legacyFreeAccess === true) return false;
  return true;
}

export function computeTrialCountUpdate({
  totalBefore,
  totalAfter,
  trialStatus,
  stocktakesAtStart,
  stocktakesUsed,
}: {
  totalBefore: number;
  totalAfter: number;
  trialStatus: string;
  stocktakesAtStart: number;
  stocktakesUsed: number;
}): { skip: boolean; newUsed: number; shouldExpire: boolean } {
  if (totalBefore === totalAfter) return { skip: true,  newUsed: stocktakesUsed, shouldExpire: false };
  if (trialStatus !== "active")   return { skip: true,  newUsed: stocktakesUsed, shouldExpire: false };
  const computed = Math.max(0, totalAfter - stocktakesAtStart);
  const newUsed = Math.max(stocktakesUsed, computed); // never decreasing
  return { skip: false, newUsed, shouldExpire: newUsed >= 3 };
}

// ── Firestore triggers ───────────────────────────────────────────────────────

export const onVenueCreated = onDocumentCreated(
  { document: "venues/{venueId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const venueId = event.params.venueId;
    const venueData = snap.data() as Record<string, any>;

    const db = admin.firestore();

    const configSnap = await db.doc("config/billing").get();
    const rawTs = configSnap.data()?.pilotTriggerDate;
    const pilotTriggerDate: Date | null = rawTs?.toDate ? rawTs.toDate() : null;

    const venueCreatedAtTs = venueData.createdAt;
    const venueCreatedAt: Date | null = venueCreatedAtTs?.toDate
      ? venueCreatedAtTs.toDate()
      : null;

    if (
      !shouldStartTrial({
        venueCreatedAt,
        pilotTriggerDate,
        ownerUid: venueData.ownerUid ?? "",
        legacyFreeAccess: venueData.legacyFreeAccess,
        founderUids: FOUNDER_UIDS,
      })
    ) {
      return;
    }

    const trialRef = db.doc(`venues/${venueId}/billing/trialState`);
    const venueRef = db.doc(`venues/${venueId}`);

    await db.runTransaction(async (tx) => {
      const trialSnap = await tx.get(trialRef);
      if (trialSnap.exists) return; // idempotent — already written

      const stocktakesAtStart: number = venueData.totalStocktakesCompleted ?? 0;
      tx.set(trialRef, {
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        venueCreatedAt: venueData.createdAt ?? null,
        stocktakesAtStart,
        stocktakesUsed: 0,
        status: "active",
      });
      tx.update(venueRef, { trialStatus: "active" });
    });

    console.log(`[trial/onVenueCreated] started trial for venue=${venueId}`);
  },
);

export const onVenueUpdated = onDocumentUpdated(
  { document: "venues/{venueId}", region: REGION },
  async (event) => {
    const { before, after } = event.data ?? {};
    if (!before || !after) return;

    const beforeData = before.data() as Record<string, any>;
    const afterData = after.data() as Record<string, any>;

    const totalBefore: number = beforeData.totalStocktakesCompleted ?? 0;
    const totalAfter: number = afterData.totalStocktakesCompleted ?? 0;

    // Exit early unless the stocktake counter changed — prevents self-trigger loops
    if (totalBefore === totalAfter) return;

    const venueId = event.params.venueId;
    const db = admin.firestore();
    const trialRef = db.doc(`venues/${venueId}/billing/trialState`);
    const venueRef = db.doc(`venues/${venueId}`);

    await db.runTransaction(async (tx) => {
      const trialSnap = await tx.get(trialRef);
      if (!trialSnap.exists) return;

      const trial = trialSnap.data() as Record<string, any>;
      const result = computeTrialCountUpdate({
        totalBefore,
        totalAfter,
        trialStatus: trial.status ?? "",
        stocktakesAtStart: trial.stocktakesAtStart ?? 0,
        stocktakesUsed: trial.stocktakesUsed ?? 0,
      });

      if (result.skip) return;

      const update: Record<string, any> = { stocktakesUsed: result.newUsed };
      if (result.shouldExpire) {
        update.status = "expired";
        update.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
        update.resolvedReason = "stocktake_limit";
        tx.update(venueRef, { trialStatus: "expired" });
      }
      tx.update(trialRef, update);
    });

    console.log(
      `[trial/onVenueUpdated] processed venue=${venueId} total=${totalAfter}`,
    );
  },
);
