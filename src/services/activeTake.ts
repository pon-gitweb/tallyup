import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth } from 'src/services/firebase';

export type ActiveSession = {
  status?: 'active'|'completed';
  startedAt?: any;
  startedBy?: string;
  completedAt?: any;
  lastDepartmentId?: string | null;
  lastAreaId?: string | null;
};

export function sessionRef(venueId: string) {
  return doc(db, `venues/${venueId}/sessions/current`);
}

export async function getActiveSession(venueId: string): Promise<ActiveSession | null> {
  const snap = await getDoc(sessionRef(venueId));
  return snap.exists() ? (snap.data() as ActiveSession) : null;
}

export function observeActiveSession(
  venueId: string,
  onChange: (s: ActiveSession | null) => void,
  onError?: (e: any) => void
) {
  return onSnapshot(sessionRef(venueId), (snap) => {
    onChange(snap.exists() ? (snap.data() as ActiveSession) : null);
  }, onError);
}

/** Ensure there is an active session (idempotent). */
export async function ensureActiveSession(venueId: string) {
  const uid = auth.currentUser?.uid || 'unknown';
  const ref = sessionRef(venueId);
  const now = serverTimestamp();
  await setDoc(ref, {
    status: 'active',
    startedAt: now,
    startedBy: uid,
  }, { merge: true });
}

/** Store the last place the user was so we can resume. */
export async function setLastLocation(venueId: string, updates: { lastDepartmentId?: string|null; lastAreaId?: string|null }) {
  const ref = sessionRef(venueId);
  await setDoc(ref, updates, { merge: true });
}

/** Complete the active session. */
export async function endActiveSession(venueId: string) {
  const ref = sessionRef(venueId);
  await updateDoc(ref, {
    status: 'completed',
    completedAt: serverTimestamp(),
  });
}
