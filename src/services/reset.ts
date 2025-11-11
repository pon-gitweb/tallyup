// src/services/reset.ts
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase'; // <- existing project export

/**
 * Full-cycle reset for a venue:
 * - venue root: sets cycleResetAt (+ updatedAt)
 * - every area under every department: startedAt:null, completedAt:null, cycleResetAt:now (+ updatedAt)
 *   (exactly what your rules permit)
 */
export async function resetAllDepartmentsStockTake(venueId: string) {
  const now = Timestamp.now();               // concrete timestamp (rules require timestamp, not just server TS)
  const updatedAt = serverTimestamp();       // okay per rules if present

  // 1) Flip the venue-level flag first (cheap and unblocks clients that only watch the root)
  await updateDoc(doc(db, 'venues', venueId), {
    cycleResetAt: now,
    updatedAt,
  });

  // 2) Reset all areas under all departments.
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  // Batch in chunks (≤ 500 writes)
  const batches: ReturnType<typeof writeBatch>[] = [];
  let batch = writeBatch(db);
  let count = 0;

  for (const dept of deptsSnap.docs) {
    const areasQ = query(collection(db, 'venues', venueId, 'departments', dept.id, 'areas'));
    const areasSnap = await getDocs(areasQ);

    for (const area of areasSnap.docs) {
      // Your rules allow any of these combinations when cycleResetAt is present:
      // ['cycleResetAt'] OR ['cycleResetAt','updatedAt'] OR
      // ['startedAt','completedAt','cycleResetAt'] (+ optional 'updatedAt')
      batch.update(area.ref, {
        startedAt: null,
        completedAt: null,
        cycleResetAt: now,
        updatedAt,
      });
      count++;
      if (count >= 450) {            // keep headroom
        batches.push(batch);
        batch = writeBatch(db);
        count = 0;
      }
    }
  }
  // push any remaining ops
  if (count > 0) batches.push(batch);

  // Commit in order
  for (const b of batches) {
    await b.commit();
  }
}