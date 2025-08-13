import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';

/**
 * Dev helper: make sure the venue doc exists and the current user is a member.
 * Uses a rules-backed "openSignup" flag so membership can be created before access.
 */
export async function ensureVenueAndMembership(venueId: string, uid: string) {
  if (!venueId || !uid) return;

  // 1) Ensure venue doc exists with openSignup=true (dev only)
  const venueRef = doc(db, `venues/${venueId}`);
  const venueSnap = await getDoc(venueRef);
  if (!venueSnap.exists()) {
    await setDoc(venueRef, {
      name: 'TallyUp Dev Venue',
      createdAt: serverTimestamp(),
      config: { openSignup: true } // gates self-enrollment in rules
    }, { merge: true });
  } else {
    // If venue exists but no config, set it (safe merge)
    const data: any = venueSnap.data() || {};
    if (!data.config || data.config.openSignup !== true) {
      await setDoc(venueRef, { config: { openSignup: true } }, { merge: true });
    }
  }

  // 2) Ensure membership doc
  const memberRef = doc(db, `venues/${venueId}/members/${uid}`);
  const memberSnap = await getDoc(memberRef);
  if (!memberSnap.exists()) {
    await setDoc(memberRef, {
      role: 'admin', // dev default; tighten later
      createdAt: serverTimestamp()
    }, { merge: true });
  }
}
