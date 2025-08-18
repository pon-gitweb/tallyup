import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Hard-pinned dev identity/venue
const DEV_EMAIL = 'test@example.com';
const PINNED_VENUE_ID = 'v_7ykrc92wuw58gbrgyicr7e';

export async function ensureDevAttachmentIfNeeded() {
  const user = auth.currentUser;
  if (!user) return;

  // Only the dev account may be auto-attached.
  const isDevUser = (user.email ?? '').toLowerCase() === DEV_EMAIL;
  if (!isDevUser) return;

  const uRef = doc(db, 'users', user.uid);
  const uSnap = await getDoc(uRef);
  const venueId = uSnap.exists() ? (uSnap.data() as any)?.venueId ?? null : null;

  if (!venueId) {
    await setDoc(uRef, { venueId: PINNED_VENUE_ID, email: user.email ?? null }, { merge: true });
    // Ensure members/{uid} exists too (idempotent)
    await setDoc(doc(db, 'venues', PINNED_VENUE_ID, 'members', user.uid),
      { uid: user.uid, role: 'staff' }, { merge: true });
    console.log('[TallyUp DevBootstrap] Attached dev user to pinned venue');
  } else {
    console.log('[TallyUp DevBootstrap] Membership OK', { uid: user.uid, venueId });
  }
}
