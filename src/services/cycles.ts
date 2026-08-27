import { collection, doc, getDocs, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { ensureDeptSessionActive } from './activeDeptTake';
import { refreshPricesForDepartment } from './refreshPricesForDepartment';

/**
 * Start a new stock-take cycle for a department (festival mode).
 *
 * - Clears startedAt/completedAt on all areas.
 * - Zeros incomingQty and soldQty on all items so stale data doesn't carry
 *   forward (separate batch per area).
 * - Calls refreshPricesForDepartment after the item batches commit, which
 *   runs the dual-pass price sync (item costPrice refresh) and physical-count
 *   basis correction (costPriceQuantityBasis on products).
 * - Clears department.completedAt and ensures the dept session is 'active'.
 *
 * Returns itemsPriceRefreshed / itemsAlreadyCurrent from the price-refresh
 * pass (forwarded from refreshPricesForDepartment).
 */
export async function startNewDepartmentCycle(
  venueId: string,
  departmentId: string,
): Promise<{ itemsPriceRefreshed: number; itemsAlreadyCurrent: number }> {
  const areasCol = collection(db, `venues/${venueId}/departments/${departmentId}/areas`);
  const snap = await getDocs(areasCol);
  const now = serverTimestamp();

  // ── Area-level reset ──────────────────────────────────────────────────────
  for (const a of snap.docs) {
    const areaRef = doc(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}`);
    await setDoc(
      areaRef,
      { startedAt: null, completedAt: null, cycleResetAt: now, lastConfirmedAt: now },
      { merge: true },
    );
  }

  // ── Zero incomingQty / soldQty on all items ───────────────────────────────
  for (const a of snap.docs) {
    const itemsSnap = await getDocs(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}/items`),
    );
    const itemBatch = writeBatch(db);
    let hasBatch = false;
    itemsSnap.forEach(itemDoc => {
      itemBatch.update(itemDoc.ref, { incomingQty: 0, soldQty: 0 });
      hasBatch = true;
    });
    if (hasBatch) await itemBatch.commit();
  }

  // ── Price refresh + physical-count basis (after the above batches commit) ─
  // refreshPricesForDepartment re-fetches items and reads their post-zero
  // lastCount values for the basis aggregation — correct for this cycle-reset
  // path since there is no confirmedCount restoration here.
  const priceResult = await refreshPricesForDepartment(venueId, departmentId);

  // ── Department-level reset ────────────────────────────────────────────────
  await setDoc(
    doc(db, `venues/${venueId}/departments/${departmentId}`),
    { completedAt: null, cycleResetAt: now },
    { merge: true },
  );

  await ensureDeptSessionActive(venueId, departmentId);

  return priceResult;
}

/**
 * Start a new stock-take cycle for ALL ACTIVE departments in a venue.
 * Departments with active=false are skipped.
 */
export async function startNewVenueCycle(venueId: string) {
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  for (const d of depts.docs) {
    const data = d.data() as any;
    const active = typeof data?.active === 'boolean' ? data.active : true;
    if (!active) continue;
    await startNewDepartmentCycle(venueId, d.id);
  }
  // Reset or mark venue session as active
  await setDoc(doc(db, `venues/${venueId}/sessions/current`), {
    status: 'active',
    restartedAt: serverTimestamp(),
  }, { merge: true });
}
