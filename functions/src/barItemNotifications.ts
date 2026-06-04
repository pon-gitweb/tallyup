import * as admin from "firebase-admin";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

// ─── Velocity threshold push notification trigger ────────────────────────────
//
// Fires whenever a bar back-of-house item is updated.
// If velocity crosses a threshold (2hr warning, 1hr critical)
// it sends an Expo push notification to all eligible members
// with a 30-minute frequency guard per product/bar/threshold.
//
// Thresholds:
//   2hr → amber  → owner + manager
//   1hr → red    → owner + manager + staff
//
// Requires: Expo push tokens stored at users/{uid}.fcmTokens

export const onBarItemVelocityUpdate = onDocumentUpdated(
  "venues/{venueId}/departments/{deptId}/areas/{areaId}/items/{itemId}",
  async (event) => {
    const before = event.data?.before.data() as any;
    const after  = event.data?.after.data()  as any;
    if (!before || !after) return;

    const { venueId, deptId, areaId, itemId } = event.params;
    const db = admin.firestore();

    // Only process back-of-house items in festival bars
    if (areaId !== "back-of-house") return;
    const deptSnap = await db.doc(`venues/${venueId}/departments/${deptId}`).get();
    if (!deptSnap.data()?.isFestivalBar) return;

    const velocity  = after.velocity  || 0;
    const stock     = after.lastCount  || 0;
    if (velocity <= 0) return;

    const hoursRemaining = stock / velocity;
    const prevVelocity   = before.velocity  || 0;
    const prevStock      = before.lastCount || 0;
    const prevHours      = prevVelocity > 0 ? prevStock / prevVelocity : 999;

    // Determine if a threshold was crossed (going below, not already below)
    let threshold: "2hr" | "1hr" | null = null;
    if      (hoursRemaining < 1 && prevHours >= 1) threshold = "1hr";
    else if (hoursRemaining < 2 && prevHours >= 2) threshold = "2hr";
    if (!threshold) return;

    // Frequency guard: don't re-notify within 30 minutes for same threshold
    const lastNotif      = after.lastNotificationAt?.toDate?.() as Date | undefined;
    const lastThreshold  = after.lastNotificationThreshold as string | undefined;
    if (lastNotif && lastThreshold === threshold) {
      const minutesSince = (Date.now() - lastNotif.getTime()) / 60_000;
      if (minutesSince < 30) return;
    }

    // Load venue members to notify
    const membersSnap = await db.collection(`venues/${venueId}/members`).get();
    const rolesToNotify = threshold === "1hr"
      ? ["owner", "manager", "staff"]
      : ["owner", "manager"];

    const uidsToNotify = membersSnap.docs
      .filter(m => rolesToNotify.includes((m.data() as any).role))
      .map(m => m.id);

    if (uidsToNotify.length === 0) return;

    // Collect Expo push tokens for those users
    const tokens: string[] = [];
    for (const uid of uidsToNotify) {
      const userSnap = await db.doc(`users/${uid}`).get();
      const userTokens: string[] = (userSnap.data() as any)?.fcmTokens || [];
      tokens.push(...userTokens);
    }
    if (tokens.length === 0) return;

    // Build notification content
    const barName     = (deptSnap.data() as any)?.name || "Bar";
    const productName = after.name || "Product";
    const hoursLabel  = hoursRemaining.toFixed(1);
    const urgency     = threshold === "1hr" ? "🔴" : "⚠️";

    const title = threshold === "1hr"
      ? `${urgency} ${barName} — ${productName} CRITICAL`
      : `${urgency} ${barName} — ${productName} running low`;
    const body = threshold === "1hr"
      ? `${hoursLabel}hrs remaining — send top-up now`
      : `${hoursLabel}hrs remaining at current velocity`;

    // Send via Expo Push API (supports FCM/APNs behind the scenes)
    const messages = tokens.map(token => ({
      to:       token,
      title,
      body,
      data: {
        screen:    "FestivalOps",
        venueId,
        barId:     deptId,
        productId: itemId,
        threshold,
      },
      sound:    threshold === "1hr" ? "default" : null,
      priority: threshold === "1hr" ? "high"    : "normal",
    }));

    try {
      const resp = await fetch("https://exp.host/--/api/v2/push/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify(messages),
      });
      if (!resp.ok) {
        console.error("[barItemNotifications] Expo push failed:", resp.status);
      }
    } catch (e: any) {
      console.error("[barItemNotifications] fetch error:", e?.message);
    }

    // Record notification to enforce frequency guard
    await db
      .doc(`venues/${venueId}/departments/${deptId}/areas/${areaId}/items/${itemId}`)
      .update({
        lastNotificationAt:        admin.firestore.FieldValue.serverTimestamp(),
        lastNotificationThreshold: threshold,
      });

    console.log(
      `[barItemNotifications] sent ${threshold} alert for ${productName} at ${barName} to ${tokens.length} device(s)`
    );
  }
);
