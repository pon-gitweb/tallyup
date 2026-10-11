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
  venueType,
}: {
  venueCreatedAt: Date | null;
  pilotTriggerDate: Date | null;
  ownerUid: string;
  legacyFreeAccess: boolean | null | undefined;
  founderUids: ReadonlySet<string>;
  venueType?: string | null;
}): boolean {
  if (!pilotTriggerDate || !venueCreatedAt) return false;
  if (venueCreatedAt < pilotTriggerDate) return false;
  if (founderUids.has(ownerUid)) return false;
  if (legacyFreeAccess === true) return false;
  if (venueType === 'festival') return false;
  return true;
}

// Legacy counter-based update — kept for existing tests; no longer called by onVenueUpdated.
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

/**
 * Determine whether a new full stocktake has been completed.
 *
 * Eligible departments = active (active !== false) AND hasAreas.
 * A full stocktake is counted when every eligible department has a server-observed
 * cycle-seen time strictly after lastFullMs.
 *
 * The venues/{v}/stockTakes venue-wide record is NOT used here: it only appears when
 * all departments finish within 7 days, and any empty or inactive department blocks it
 * entirely — a slow venue or one with a placeholder department would never advance.
 * Counting individual department cycles, ignoring empty and inactive ones, matches the
 * intent more faithfully.
 */
export function computeFullStocktake({
  lastFullMs,
  seenByDept,
  departments,
}: {
  lastFullMs: number;
  seenByDept: Record<string, number>;
  departments: ReadonlyArray<{ id: string; active: boolean; hasAreas: boolean }>;
}): { counted: boolean; newLastFullMs: number } {
  const eligible = departments.filter(d => d.active !== false && d.hasAreas);
  if (eligible.length === 0) return { counted: false, newLastFullMs: lastFullMs };

  const allNew = eligible.every(d => (seenByDept[d.id] ?? 0) > lastFullMs);
  if (!allNew) return { counted: false, newLastFullMs: lastFullMs };

  const newLastFullMs = Math.max(...eligible.map(d => seenByDept[d.id]!));
  return { counted: true, newLastFullMs };
}

/**
 * Update a department's server-observed cycle time, keeping the maximum.
 * A late or duplicate delivery can never move the seen time backwards.
 */
export function applyDeptCycleSeen(
  existing: Record<string, number>,
  departmentId: string,
  serverTimeMs: number,
): Record<string, number> {
  const prev = existing[departmentId] ?? 0;
  return { ...existing, [departmentId]: Math.max(prev, serverTimeMs) };
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

    const venueType: string | null =
      typeof venueData.venueType === "string" ? venueData.venueType : null;

    if (
      !shouldStartTrial({
        venueCreatedAt,
        pilotTriggerDate,
        ownerUid: venueData.ownerUid ?? "",
        legacyFreeAccess: venueData.legacyFreeAccess,
        founderUids: FOUNDER_UIDS,
        venueType,
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
      // lastFullStocktakeAtMs is the baseline: only department cycles created AFTER this
      // time count toward the trial limit.
      tx.set(trialRef, {
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        venueCreatedAt: venueData.createdAt ?? null,
        stocktakesAtStart,
        stocktakesUsed: 0,
        status: "active",
        lastFullStocktakeAtMs: Date.now(),
        deptCycleSeenMs: {},
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

    // stocktakesUsed is now maintained by onDepartmentCycleCreated, not by watching
    // totalStocktakesCompleted. That counter keeps incrementing for non-trial consumers
    // (health scores, reports, dashboard) — it is no longer wired to trialState.
    // onDepartmentCycleCreated uses the document's server createTime (which the client
    // cannot forge), counts only when every active dept with areas has a cycle since
    // the last full count, and is idempotent under duplicate deliveries.
    if (totalBefore === totalAfter) return;
    // Nothing further until time-based expiry is implemented here.
  },
);

export const onDepartmentCycleCreated = onDocumentCreated(
  { document: "venues/{venueId}/departments/{departmentId}/cycles/{cycleId}", region: REGION },
  async (event) => {
    const venueId = event.params.venueId;
    const departmentId = event.params.departmentId;

    // Use the document's server-assigned creation time — never the client's completedAt.
    // Firestore sets createTime when the document is committed server-side.
    // A client cannot forge this value; a future-dated completedAt field in the document
    // has no effect on what is counted.
    const serverTimeMs: number = event.data?.createTime?.toMillis?.() ?? Date.now();

    const db = admin.firestore();
    const trialRef = db.doc(`venues/${venueId}/billing/trialState`);
    const venueRef = db.doc(`venues/${venueId}`);

    // Quick bail before the department + area reads
    const quickSnap = await trialRef.get();
    if (!quickSnap.exists || quickSnap.data()?.status !== "active") return;

    // Read all departments and which have at least one area.
    // Done outside the transaction to keep the transaction small.
    // If a department gains or loses its first area between here and the transaction,
    // the next cycle event re-evaluates — acceptable for a trial counter.
    const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
    const departments: Array<{ id: string; active: boolean; hasAreas: boolean }> = [];
    for (const d of deptsSnap.docs) {
      const data = d.data() as any;
      const active = typeof data.active === "boolean" ? data.active : true;
      const areasSnap = await db
        .collection(`venues/${venueId}/departments/${d.id}/areas`)
        .limit(1)
        .get();
      departments.push({ id: d.id, active, hasAreas: !areasSnap.empty });
    }

    await db.runTransaction(async (tx) => {
      const [trialSnap, venueSnap] = await Promise.all([
        tx.get(trialRef),
        tx.get(venueRef),
      ]);

      if (!trialSnap.exists) return;
      const trial = trialSnap.data() as Record<string, any>;
      if (trial.status !== "active") return;

      // Venue-level exemptions — same guards as onVenueCreated
      const venueData = venueSnap.data() as Record<string, any> | undefined;
      if (!venueData) return;
      if (venueData.venueType === "festival") return;
      if (venueData.legacyFreeAccess === true) return;
      if (FOUNDER_UIDS.has(venueData.ownerUid ?? "")) return;

      const updatedSeen = applyDeptCycleSeen(
        trial.deptCycleSeenMs ?? {},
        departmentId,
        serverTimeMs,
      );

      const lastFullMs: number = trial.lastFullStocktakeAtMs ?? 0;
      const currentUsed: number = trial.stocktakesUsed ?? 0;

      const { counted, newLastFullMs } = computeFullStocktake({
        lastFullMs,
        seenByDept: updatedSeen,
        departments,
      });

      const trialUpdate: Record<string, any> = { deptCycleSeenMs: updatedSeen };

      if (counted) {
        const newUsed = Math.min(3, currentUsed + 1);
        trialUpdate.stocktakesUsed = newUsed;
        trialUpdate.lastFullStocktakeAtMs = newLastFullMs;

        if (newUsed >= 3) {
          trialUpdate.status = "expired";
          trialUpdate.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
          trialUpdate.resolvedReason = "stocktake_limit";
          tx.update(venueRef, { trialStatus: "expired" });
        }
      }

      tx.update(trialRef, trialUpdate);
    });

    console.log(
      `[trial/onDepartmentCycleCreated] venue=${venueId} dept=${departmentId} serverTimeMs=${serverTimeMs}`,
    );
  },
);
