import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';

/**
 * Ensure the user has a member record in the given venue. If the venue is configured
 * with openSignup, this will auto-join; otherwise it creates a minimal member doc as admin
 * (dev-friendly). In production you may restrict this path.
 */
export async function ensureVenueAndMembership(venueId: string, uid: string) {
  if (!venueId || !uid) return;

  // If already a member, nothing to do.
  const mr = doc(db, `venues/${venueId}/members/${uid}`);
  const ms = await getDoc(mr);
  if (ms.exists()) return;

  // Check if venue allows open signup
  const vr = doc(db, `venues/${venueId}`);
  const vs = await getDoc(vr);
  const v = (vs.data() as any) || {};
  const open = !!v?.config?.openSignup;

  // Create member entry (dev default = admin so you aren't blocked during MVP)
  await setDoc(mr, {
    role: 'admin',
    joinedAt: serverTimestamp(),
    via: open ? 'openSignup' : 'devEnsure',
  }, { merge: true });
}
