import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from 'src/services/firebase';

export type DeptSession = {
  status?: 'active'|'completed';
  startedAt?: any;
  startedBy?: string;
  lastAreaId?: string | null;
};

export function deptSessionRef(venueId: string, departmentId: string) {
  // Must be an even number of segments -> use 'session/current'
  return doc(db, `venues/${venueId}/departments/${departmentId}/session/current`);
}

export function observeDeptSession(
  venueId: string, departmentId: string,
  onChange: (s: DeptSession | null) => void,
  onError?: (e: any) => void
) {
  return onSnapshot(deptSessionRef(venueId, departmentId), (snap) => {
    onChange(snap.exists() ? (snap.data() as DeptSession) : null);
  }, onError);
}

export async function ensureDeptSessionActive(venueId: string, departmentId: string) {
  const uid = auth.currentUser?.uid || 'unknown';
  await setDoc(deptSessionRef(venueId, departmentId), {
    status: 'active',
    startedAt: serverTimestamp(),
    startedBy: uid,
  }, { merge: true });
}

export async function setDeptLastArea(venueId: string, departmentId: string, areaId: string | null) {
  await setDoc(deptSessionRef(venueId, departmentId), { lastAreaId: areaId }, { merge: true });
}

export async function completeDeptSession(venueId: string, departmentId: string) {
  await setDoc(deptSessionRef(venueId, departmentId), { status: 'completed' }, { merge: true });
}
