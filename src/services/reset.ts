import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../services/firebase';

/** Reset ONE department: writes session markers + reopens all areas */
export async function resetDepartmentStockTake(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) throw new Error('Missing venue/department');
  const now = serverTimestamp();

  // Venue-root session marker
  const rootSessionRef = doc(db, 'venues', venueId, 'sessions', departmentId);
  await setDoc(rootSessionRef, { reason: 'manual-reset', updatedAt: now }, { merge: true });

  // Department-scoped session marker (legacy path)
  const deptSessionRef = doc(db, 'venues', venueId, 'departments', departmentId, 'session', 'reset');
  await setDoc(deptSessionRef, { reason: 'manual-reset', updatedAt: now }, { merge: true });

  // Reopen all areas in department
  const areasCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
  const snap = await getDocs(query(areasCol));
  for (const d of snap.docs) {
    await updateDoc(d.ref, { startedAt: null, completedAt: null, updatedAt: now });
  }
  return { ok: true, count: snap.size, departmentId };
}

/** Reset ALL departments under the venue */
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
