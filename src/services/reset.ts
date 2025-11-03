import {
  collection, doc, getDocs, query, serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Reset ONE department:
 * - Reopens ALL areas that belong to departmentId in venue-level collection:
 *   venues/{venueId}/areas (filter departmentId == departmentId)
 * - Sets: startedAt:null, completedAt:null, cycleResetAt:now
 *   This matches the "isCycleReset" branch allowed in your rules.
 */
export async function resetDepartmentStockTake(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) throw new Error('Missing venue/department');
  const now = serverTimestamp();

  // Query venue-level areas for this department
  const areasCol = collection(db, 'venues', venueId, 'areas');
  const snap = await getDocs(query(areasCol, where('departmentId', '==', departmentId)));

  for (const d of snap.docs) {
    // Lifecycle reset write that your rules allow (cycleResetAt present)
    await updateDoc(doc(db, 'venues', venueId, 'areas', d.id), {
      startedAt: null,
      completedAt: null,
      cycleResetAt: now,
    });
  }
  return { ok: true, count: snap.size, departmentId };
}

/**
 * Reset ALL departments for a venue by running the department reset per ID.
 */
export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) throw new Error('Missing venueId');

  // Collect all department IDs
  const depsCol = collection(db, 'venues', venueId, 'departments');
  const dsnap = await getDocs(depsCol);

  let totalAreas = 0;
  for (const dep of dsnap.docs) {
    const res = await resetDepartmentStockTake(venueId, dep.id);
    totalAreas += res.count;
  }
  return { ok: true, departments: dsnap.size, areasReset: totalAreas };
}
