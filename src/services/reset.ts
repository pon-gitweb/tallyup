import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Reset ONE department:
 * - Writes session markers (both accepted paths by rules)
 * - Reopens all areas by setting startedAt:null, completedAt:null, cycleResetAt:now
 *   in a SINGLE update that matches the rule.
 */
export async function resetDepartmentStockTake(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) throw new Error('Missing venue/department');
  const now = serverTimestamp();

  // Session markers
  await setDoc(doc(db, 'venues', venueId, 'sessions', departmentId),
    { reason: 'manual-reset', updatedAt: now }, { merge: true });

  await setDoc(doc(db, 'venues', venueId, 'departments', departmentId, 'session', 'reset'),
    { reason: 'manual-reset', updatedAt: now }, { merge: true });

  // Reopen all areas with a lifecycle RESET write (must match rules)
  const areasCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
  const snap = await getDocs(query(areasCol));
  for (const d of snap.docs) {
    await updateDoc(d.ref, {
      startedAt: null,
      completedAt: null,
      cycleResetAt: now,   // key to satisfy isCycleReset()
    });
  }
  return { ok: true, count: snap.size, departmentId };
}

export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) throw new Error('Missing venueId');
  const depsCol = collection(db, 'venues', venueId, 'departments');
  const dsnap = await getDocs(query(depsCol));
  let totalAreas = 0;
  for (const dep of dsnap.docs) {
    const res = await resetDepartmentStockTake(venueId, dep.id);
    totalAreas += res.count;
  }
  return { ok: true, departments: dsnap.size, areasReset: totalAreas };
}
