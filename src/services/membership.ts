import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';

/** Check if user is already a member of venue */
export async function isMember(venueId: string, uid: string) {
  if (!venueId || !uid) return false;
  const ref = doc(db, `venues/${venueId}/members/${uid}`);
  const snap = await getDoc(ref);
  return snap.exists();
}

/** Join venue when venue.config.openSignup == true (rules enforce this) */
export async function joinVenueOpenSignup(venueId: string, uid: string) {
  const ref = doc(db, `venues/${venueId}/members/${uid}`);
  await setDoc(ref, { role: 'admin', createdAt: serverTimestamp() }, { merge: true });
}
