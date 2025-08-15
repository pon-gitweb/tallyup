import { auth, db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DEV_VENUE_ID, DEV_AUTO_SIGNUP } from '../config/dev';

/**
 * Ensure the signed-in user has membership under the dev venue.
 * Safe with current rules: user can update /users/{uid}, then membership becomes allowed.
 */
export async function ensureDevMembership() {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');

  const uid = user.uid;
  // 1) ensure /users/{uid}.venueId points at DEV_VENUE_ID (dev only)
  if (DEV_AUTO_SIGNUP) {
    await setDoc(doc(db, 'users', uid), { venueId: DEV_VENUE_ID, email: user.email ?? null }, { merge: true });
  }

  // 2) write membership doc for this user (allowed because user.venueId == venueId now)
  await setDoc(doc(db, 'venues', DEV_VENUE_ID, 'members', uid), {
    uid,
    role: 'member',
    attachedAt: serverTimestamp(),
  }, { merge: true });

  console.log('[TallyUp DevBootstrap] Membership OK', { uid, venueId: DEV_VENUE_ID });
  return { uid, venueId: DEV_VENUE_ID };
}

/**
 * Ensure venue session doc exists and is 'active'. Returns sessionId ("current").
 */
export async function ensureActiveSession(venueId: string) {
  const ref = doc(db, 'venues', venueId, 'sessions', 'current');
  const snap = await getDoc(ref);
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
  return 'current';
}

/**
 * DEV-ONLY: Attach the current user to any venue by ID.
 * Implementation mirrors ensureDevMembership but for an arbitrary venueId.
 */
export async function attachSelfToVenue(venueId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  const uid = user.uid;

  // Set user profile venueId (allowed by rules)
  await setDoc(doc(db, 'users', uid), { venueId, email: user.email ?? null }, { merge: true });

  // Create/merge membership under venue (now allowed because user.venueId == venueId)
  await setDoc(doc(db, 'venues', venueId, 'members', uid), {
    uid,
    role: 'member',
    attachedAt: serverTimestamp(),
  }, { merge: true });

  console.log('[TallyUp DevBootstrap] Attached self to venue', { uid, venueId });
  return { uid, venueId };
}

/**
 * Read the user's current venue from their /users/{uid} profile (if set).
 */
export async function getCurrentVenueForUser(): Promise<{ uid: string; venueId: string | null; email?: string | null }> {
  const user = auth.currentUser;
  if (!user) throw new Error('No user signed in');
  const uid = user.uid;
  const u = await getDoc(doc(db, 'users', uid));
  const email = user.email ?? null;
  const venueId = u.exists() ? (u.data() as any)?.venueId ?? null : null;
  return { uid, venueId, email };
}
