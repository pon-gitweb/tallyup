import { auth, db } from './firebase';
import { DEV_VENUE_ID, DEV_AUTO_SIGNUP } from '../config/dev';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export async function ensureDevMembership(): Promise<{ venueId: string; uid: string; email: string | null; }> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user; please log in first.');

  const venueRef = doc(db, 'venues', DEV_VENUE_ID);
  const venueSnap = await getDoc(venueRef);
  if (!venueSnap.exists()) throw new Error(`Pinned venue ${DEV_VENUE_ID} does not exist.`);

  const cfg = (venueSnap.data() as any)?.config ?? {};
  const openSignup = !!cfg.openSignup;

  const memberRef = doc(db, 'venues', DEV_VENUE_ID, 'members', user.uid);
  const memberSnap = await getDoc(memberRef);

  if (!memberSnap.exists()) {
    if (openSignup && DEV_AUTO_SIGNUP) {
      await setDoc(memberRef, {
        email: user.email ?? null,
        role: 'owner',
        joinedAt: serverTimestamp(),
        source: 'tallyup-dev-bootstrap',
      }, { merge: true });
      console.log('[TallyUp DevBootstrap]', 'Membership CREATED', { uid: user.uid, venueId: DEV_VENUE_ID });
    } else {
      throw new Error('Not a member and openSignup is disabled. Ask an admin to add you.');
    }
  } else {
    console.log('[TallyUp DevBootstrap]', 'Membership OK', { uid: user.uid, venueId: DEV_VENUE_ID });
  }

  return { venueId: DEV_VENUE_ID, uid: user.uid, email: user.email ?? null };
}

export async function ensureActiveSession(venueId: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user.');

  const sessionId = 'current';
  const sessionRef = doc(db, 'venues', venueId, 'sessions', sessionId);
  const snap = await getDoc(sessionRef);

  if (!snap.exists()) {
    await setDoc(sessionRef, {
      status: 'active',
      startedAt: serverTimestamp(),
      createdBy: user.uid,
      createdByEmail: user.email ?? null
    }, { merge: true });
    console.log('[TallyUp Session] Created active session:', sessionRef.path);
  } else {
    const data = snap.data() as any;
    if (data?.status !== 'active') {
      await setDoc(sessionRef, { status: 'active', resumedAt: serverTimestamp() }, { merge: true });
      console.log('[TallyUp Session] Resumed session:', sessionRef.path);
    } else {
      console.log('[TallyUp Session] Active session present:', sessionRef.path);
    }
  }

  return sessionId;
}

export async function runDevBootstrapSilently() {
  try {
    if (!__DEV__) return;
    await ensureDevMembership();
  } catch (e) {
    console.log('[TallyUp DevBootstrap] Skipped:', (e as Error).message);
  }
}
