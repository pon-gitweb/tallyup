import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";

/**
 * Idempotently ensures server-owned venue docs exist.
 * Writes are via Admin SDK (bypasses rules) -> correct for server-only collections.
 */
export async function ensureVenueDefaults(venueId: string, actorUid?: string) {
  const db = admin.firestore();

  const entRef = db.doc(`venues/${venueId}/entitlements/core`);
  const billRef = db.doc(`venues/${venueId}/billing/status`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  // Use create() so we don't overwrite if already present.
  // If it exists, create() throws ALREADY_EXISTS; we ignore.
  await entRef.create({
    kind: "core_entitlements",
    venueId,
    enforcementMode: "monitor", // monitor-only for now; enforcement later
    stockTakesCompleted: 0,
    freeStockTakesAllowance: 2,
    createdAt: now,
    updatedAt: now,
  }).catch((e: any) => {
    if (e?.code !== 6) throw e; // 6 = ALREADY_EXISTS
  });

  await billRef.create({
    kind: "billing_status",
    venueId,
    status: "unknown",      // will be updated by billing integration later
    readOnly: false,        // survivability-first later
    createdAt: now,
    updatedAt: now,
  }).catch((e: any) => {
    if (e?.code !== 6) throw e;
  });

  // Append-only event (always ok to write)
  const evRef = db.collection(`venues/${venueId}/events`).doc();
  await evRef.set({
    type: "venue_defaults_ensured",
    venueId,
    actorUid: actorUid ?? null,
    createdAt: now,
  });
}

/**
 * Optional callable for operators/admin to backfill a venue.
 * Keeps scope narrow: only ensures defaults, does not enforce paywall.
 */
export const ensureVenueDefaultsCallable = onCall(async (req) => {
  if (!req.auth) {
    throw new Error("unauthenticated");
  }
  const venueId = (req.data?.venueId ?? "").toString();
  if (!venueId) {
    throw new Error("missing_venueId");
  }

  await ensureVenueDefaults(venueId, req.auth.uid);
  return { ok: true };
});
