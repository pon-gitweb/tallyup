import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Reset ONE department:
 * - Write session markers to both accepted paths (root + legacy)
 * - Reopen all areas (startedAt:null, completedAt:null) WITHOUT updatedAt
 *   so it passes the lifecycle-only rules branch.
 */
export async function resetDepartmentStockTake(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) throw new Error('Missing venue/department');
  const now = serverTimestamp();

  // Session markers (both paths are allowed by rules)
  const rootSessionRef = doc(db, 'venues', venueId, 'sessions', departmentId);
  await setDoc(rootSessionRef, { reason: 'manual-reset', updatedAt: now }, { merge: true });

  const deptSessionRef = doc(db, 'venues', venueId, 'departments', departmentId, 'session', 'reset');
  await setDoc(deptSessionRef, { reason: 'manual-reset', updatedAt: now }, { merge: true });

  // Reopen all areas: ONLY lifecycle fields to satisfy rules
  const areasCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
  const snap = await getDocs(query(areasCol));
  for (const d of snap.docs) {
    // IMPORTANT: do NOT include updatedAt here
    await updateDoc(d.ref, { startedAt: null, completedAt: null });
  }
  return { ok: true, count: snap.size, departmentId };
}

/** Reset ALL departments in a venue */
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
