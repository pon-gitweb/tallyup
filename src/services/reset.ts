import {
  collection, getDocs, writeBatch, doc, serverTimestamp, query, where,
  setDoc, updateDoc, increment, deleteDoc,
} from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Pure decision: should the venue-wide stocktakeActive flag be cleared?
 * Returns true when every area in every department has startedAt == null AND completedAt == null.
 * areasByDept: one entry per department, each being that department's area data objects.
 */
export function shouldClearStocktakeActive(
  areasByDept: Array<Array<{ startedAt: any; completedAt: any }>>,
): boolean {
  for (const deptAreas of areasByDept) {
    for (const area of deptAreas) {
      if (area.startedAt != null || area.completedAt != null) return false;
    }
  }
  return true;
}

function resetAreaInBatch(batch: ReturnType<typeof writeBatch>, areaRef: any, now: any) {
  batch.update(areaRef, {
    startedAt: null,
    completedAt: null,
    cycleResetAt: now,
    updatedAt: now,
    lastConfirmedAt: now,
    editWindowClosesAt: null,
  });
}

export async function resetDepartment(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) return;
  const now = serverTimestamp();

  // Step 1: Reset area flags
  const areaBatch = writeBatch(db);
  const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas'));
  areasSnap.forEach((d) => {
    resetAreaInBatch(areaBatch, doc(db, 'venues', venueId, 'departments', departmentId, 'areas', d.id), now);
  });
  try {
    const legacyQ = query(collection(db, 'venues', venueId, 'areas'), where('departmentId', '==', departmentId));
    const legacySnap = await getDocs(legacyQ);
    legacySnap.forEach((d) => {
      resetAreaInBatch(areaBatch, doc(db, 'venues', venueId, 'areas', d.id), now);
    });
  } catch {}
  await areaBatch.commit();

  // Step 2: Restore lastCount from confirmedCount on all items (separate batch per area)
  for (const areaDoc of areasSnap.docs) {
    const itemsSnap = await getDocs(
      collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaDoc.id, 'items')
    );
    const itemBatch = writeBatch(db);
    let hasRestores = false;
    itemsSnap.forEach(itemDoc => {
      const data = itemDoc.data();
      if (typeof data.confirmedCount === 'number') {
        itemBatch.update(itemDoc.ref, {
          lastCount: data.confirmedCount,
          lastCountAt: null,
          incomingQty: 0,
          soldQty: 0,
        });
        hasRestores = true;
      }
    });
    if (hasRestores) await itemBatch.commit();
  }

  // Drain queued invoices for this department (parked while stocktakeActive was true)
  try {
    const queueSnap = await getDocs(
      query(collection(db, 'venues', venueId, 'queuedInvoices'), where('departmentId', '==', departmentId))
    );
    for (const qDoc of queueSnap.docs) {
      const data = qDoc.data() as any;
      const itemRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', data.areaId, 'items', data.itemId);
      const qBatch = writeBatch(db);
      qBatch.update(itemRef, { incomingQty: increment(data.qty) });
      qBatch.delete(qDoc.ref);
      await qBatch.commit();
    }
    if (!queueSnap.empty) {
      console.log(`[Reset] processed ${queueSnap.size} queued invoices for dept ${departmentId}`);
    }
  } catch (e: any) {
    console.warn('[Reset] queued invoice processing failed (non-fatal):', e?.message);
  }

  // If this was the last open department, clear the venue-wide stocktakeActive flag.
  // "Mid-cycle" = startedAt != null OR completedAt != null (resetAreaInBatch nulls both).
  // Only clears, never sets — worst failure mode is a skipped clear, never a wrong false.
  // Concurrent dept resets are safe: the later-finishing thread re-runs the check and clears.
  // Legacy venue-level areas excluded: nothing can start a count on them (setter is modern-path only).
  try {
    const allDepsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
    const areasByDept: Array<Array<{ startedAt: any; completedAt: any }>> = [];
    for (const depDoc of allDepsSnap.docs) {
      const depAreasSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', depDoc.id, 'areas')
      );
      const areas = depAreasSnap.docs.map(a => {
        const d = a.data();
        return { startedAt: d.startedAt ?? null, completedAt: d.completedAt ?? null };
      });
      areasByDept.push(areas);
      // Stop fetching once we know the flag must stay set
      if (!shouldClearStocktakeActive([areas])) break;
    }
    if (shouldClearStocktakeActive(areasByDept)) {
      await updateDoc(doc(db, 'venues', venueId), {
        stocktakeActive: false,
        stocktakeActiveAt: null,
      });
      console.log('[Reset] all departments closed — cleared venue stocktakeActive');
    }
  } catch (e: any) {
    console.warn('[Reset] stocktakeActive clear check failed (non-fatal):', e?.message);
  }
}

export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) return;

  // Step 1: Reset all area flags — split into separate writes to identify failures
  const now = serverTimestamp();
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  // A) Reset each department's areas individually
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    const depBatch = writeBatch(db);
    areasSnap.forEach((a) => {
      resetAreaInBatch(depBatch, doc(db, 'venues', venueId, 'departments', dep.id, 'areas', a.id), now);
    });
    try {
      await depBatch.commit();
      console.log('[Reset] dept areas ok:', dep.id);
    } catch(e: any) {
      console.error('[Reset] dept areas FAILED:', dep.id, e?.code, e?.message);
      throw e;
    }
  }

  // B) Sweep legacy venue-level areas
  const venueAreasSnap = await getDocs(collection(db, 'venues', venueId, 'areas'));
  if (!venueAreasSnap.empty) {
    const legacyBatch = writeBatch(db);
    venueAreasSnap.forEach((a) => {
      resetAreaInBatch(legacyBatch, doc(db, 'venues', venueId, 'areas', a.id), now);
    });
    try {
      await legacyBatch.commit();
      console.log('[Reset] legacy areas ok');
    } catch(e: any) {
      console.error('[Reset] legacy areas FAILED:', e?.code, e?.message);
      throw e;
    }
  }

  // C) Update venue root cycleResetAt for UI cache busting (best effort — don't fail if denied)
  try {
    const venueBatch = writeBatch(db);
    venueBatch.update(doc(db, 'venues', venueId), { cycleResetAt: now, updatedAt: now });
    await venueBatch.commit();
    console.log('[Reset] venue root ok');
  } catch(e: any) {
    console.warn('[Reset] venue root update skipped (non-fatal):', e?.code);
    // Non-fatal — area resets already succeeded
  }

  // Step 2: Restore lastCount from confirmedCount on all items (separate batches per area)
  for (const dep of depsSnap.docs) {
    const areasSnap2 = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const a of areasSnap2.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', a.id, 'items'));
      const itemBatch = writeBatch(db);
      let hasRestores = false;
      itemsSnap.forEach(itemDoc => {
        const data = itemDoc.data();
        if (typeof data.confirmedCount === 'number') {
          itemBatch.update(itemDoc.ref, { lastCount: data.confirmedCount, lastCountAt: null, incomingQty: 0, soldQty: 0 });
          hasRestores = true;
        }
      });
      if (hasRestores) await itemBatch.commit();
    }
  }

  // Clear stocktake active flag
  await updateDoc(doc(db, 'venues', venueId), {
    stocktakeActive: false,
    stocktakeActiveAt: null,
  });

  // Process any invoices queued during the stocktake
  try {
    const queueSnap = await getDocs(
      collection(db, 'venues', venueId, 'queuedInvoices')
    );
    for (const qDoc of queueSnap.docs) {
      const data = qDoc.data() as any;
      const itemRef = doc(db,
        'venues', venueId,
        'departments', data.departmentId,
        'areas', data.areaId,
        'items', data.itemId
      );
      const qBatch = writeBatch(db);
      qBatch.update(itemRef, { incomingQty: increment(data.qty) });
      qBatch.delete(qDoc.ref);
      await qBatch.commit();
    }
    if (!queueSnap.empty) {
      console.log(`[Reset] processed ${queueSnap.size} queued invoices`);
    }
  } catch (e: any) {
    console.warn('[Reset] queued invoice processing failed (non-fatal):', e?.message);
  }
}
