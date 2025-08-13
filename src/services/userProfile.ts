import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from 'src/services/firebase';

export async function getUserVenueId(uid: string): Promise<string | null> {
  if (!uid) return null;
  const ref = doc(db, `users/${uid}`);
  const snap = await getDoc(ref);
  const data = snap.data() as any;
  return (data && typeof data.venueId === 'string' && data.venueId) ? data.venueId : null;
}

export async function setUserVenueId(uid: string, venueId: string): Promise<void> {
  if (!uid || !venueId) return;
  const ref = doc(db, `users/${uid}`);
  await setDoc(ref, { venueId }, { merge: true });
}
