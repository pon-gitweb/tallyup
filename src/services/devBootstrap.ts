import { auth, db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DEV_VENUE_ID, DEV_AUTO_SIGNUP } from '../config/dev';
import { retryWrite } from './retry';

/** Return current user's venue (from /users). */
export async function getCurrentVenueForUser(): Promise<{ uid: string; venueId: string | null; email?: string | null }> {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  const uid = user.uid;
  const u = await getDoc(doc(db, 'users', uid));
  const email = user.email ?? null;
  const venueId = u.exists() ? (u.data() as any)?.venueId ?? null : null;
  return { uid, venueId, email };
}

/**
 * If the user already has a venue in their /users profile, return it.
 * Otherwise (dev only), attach them to DEV_VENUE_ID.
 */
export async function ensureDevMembership() {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  const uid = user.uid;

  const uRef = doc(db, 'users', uid);
  const uSnap = await getDoc(uRef);
  const existingVenue: string | null = uSnap.exists() ? (uSnap.data() as any)?.venueId ?? null : null;

  if (existingVenue) {
    await setDoc(doc(db, 'venues', existingVenue, 'members', uid), {
      uid, role: 'member', attachedAt: serverTimestamp(),
    }, { merge: true });
    console.log('[TallyUp DevBootstrap] Membership OK', { uid, venueId: existingVenue });
    return { uid, venueId: existingVenue };
  }

  if (DEV_AUTO_SIGNUP) {
    await setDoc(uRef, { venueId: DEV_VENUE_ID, email: user.email ?? null }, { merge: true });
  }
  await setDoc(doc(db, 'venues', DEV_VENUE_ID, 'members', uid), {
    uid, role: 'member', attachedAt: serverTimestamp(),
  }, { merge: true });

  console.log('[TallyUp DevBootstrap] Membership OK', { uid, venueId: DEV_VENUE_ID });
  return { uid, venueId: DEV_VENUE_ID };
}

/** Attach current user to an explicit venueId (dev tool). */
export async function attachSelfToVenue(venueId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  const uid = user.uid;

  await setDoc(doc(db, 'users', uid), { venueId }, { merge: true });
  await setDoc(doc(db, 'venues', venueId, 'members', uid), {
    uid, role: 'member', attachedAt: serverTimestamp(),
  }, { merge: true });

  return { uid, venueId };
}

/** Ensure a venue session is 'active' (used by Start/Return) */
export async function ensureActiveSession(venueId: string) {
  const ref = doc(db, 'venues', venueId, 'sessions', 'current');
  const snap = await getDoc(ref);
  await retryWrite(async () => {
    if (!snap.exists()) {
      await setDoc(ref, { status: 'active', startedAt: serverTimestamp() }, { merge: true });
      console.log('[TallyUp Session] Created active session:', ref.path);
    } else {
      const st = (snap.data() as any)?.status;
      if (st !== 'active') {
        await setDoc(ref, { status: 'active', resumedAt: serverTimestamp() }, { merge: true });
        console.log('[TallyUp Session] Resumed session:', ref.path);
      } else {
        console.log('[TallyUp Session] Active session present:', ref.path);
      }
    }
  });
  return 'current';
}
