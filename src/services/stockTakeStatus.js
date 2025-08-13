import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/** Ensure stockTakes/{deptId} exists and is marked in_progress. */
export async function ensureDeptInProgress(venueId, deptId, deptName = 'Department') {
  const ref = doc(db, 'venues', venueId, 'stockTakes', deptId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      departmentId: deptId,
      departmentName: deptName,
      status: 'in_progress',
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else if (snap.data()?.status !== 'in_progress') {
    await updateDoc(ref, { status: 'in_progress', updatedAt: serverTimestamp() });
  }
  return ref;
}
