import {
  collection, getDocs, writeBatch, doc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '../services/firebase';

function resetAreaInBatch(batch: ReturnType<typeof writeBatch>, areaRef: any, now: any) {
  batch.update(areaRef, {
    startedAt: null,
    completedAt: null,
    cycleResetAt: now,
    updatedAt: now,
  });
}

export async function resetDepartment(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) return;
  const now = serverTimestamp();
  const batch = writeBatch(db);
  const nestedAreasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas'));
  nestedAreasSnap.forEach((d) => {
    resetAreaInBatch(batch, doc(db, 'venues', venueId, 'departments', departmentId, 'areas', d.id), now);
  });
  try {
    const legacyQ = query(collection(db, 'venues', venueId, 'areas'), where('departmentId', '==', departmentId));
    const legacySnap = await getDocs(legacyQ);
    legacySnap.forEach((d) => {
      resetAreaInBatch(batch, doc(db, 'venues', venueId, 'areas', d.id), now);
    });
  } catch {}
  await batch.commit();
}

export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) return;

  // Step 1: Reset all area flags in one batch
  const now = serverTimestamp();
  const areaBatch = writeBatch(db);
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    areasSnap.forEach((a) => {
      resetAreaInBatch(areaBatch, doc(db, 'venues', venueId, 'departments', dep.id, 'areas', a.id), now);
    });
  }

  // Also sweep legacy venue-level areas
  const venueAreasSnap = await getDocs(collection(db, 'venues', venueId, 'areas'));
  venueAreasSnap.forEach((a) => {
    resetAreaInBatch(areaBatch, doc(db, 'venues', venueId, 'areas', a.id), now);
  });

  // Update venue root
  areaBatch.update(doc(db, 'venues', venueId), { cycleResetAt: now, updatedAt: now });
  await areaBatch.commit();

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
          itemBatch.update(itemDoc.ref, { lastCount: data.confirmedCount, lastCountAt: data.confirmedCountAt ?? null });
          hasRestores = true;
        }
      });
      if (hasRestores) await itemBatch.commit();
    }
  }
}
