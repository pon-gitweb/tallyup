import { getAuth } from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';

/**
 * IMPORTANT:
 * - Membership path matches your rules: venues/{venueId}/members/{uid}
 * - We also expose a "pin" helper because logs referenced it earlier.
 * - We export both named and default to cover either import style.
 */

const DEV_VENUE = 'v_7ykrc92wuw58gbrgyicr7e';

export async function pinDevVenueIfEnvSet() {
  try {
    const uid = getAuth()?.currentUser?.uid;
    if (!uid) return { ok: false, reason: 'no_uid' };

    const db = getFirestore();
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    const now = serverTimestamp();

    if (!snap.exists()) {
      await setDoc(userRef, { uid, venueId: DEV_VENUE, createdAt: now, updatedAt: now, source: 'devBootstrap.pin' }, { merge: true });
      console.log('[TallyUp DevBootstrap] dev pin set', { uid, venueId: DEV_VENUE });
      return { ok: true, venueId: DEV_VENUE };
    }

    const current = (snap.data() as any)?.venueId;
    if (current === DEV_VENUE) {
      console.log('[TallyUp DevBootstrap] dev pin skipped — already set', { uid, venueId: DEV_VENUE });
      return { ok: true, venueId: DEV_VENUE, skipped: true };
    }

    await updateDoc(userRef, { venueId: DEV_VENUE, updatedAt: now });
    console.log('[TallyUp DevBootstrap] dev pin updated', { uid, venueId: DEV_VENUE });
    return { ok: true, venueId: DEV_VENUE, updated: true };
  } catch (e: any) {
    console.warn('[TallyUp DevBootstrap] pinDevVenueIfEnvSet failed:', e?.message || e);
    return { ok: false, reason: 'error', error: e?.message || String(e) };
  }
}

export async function ensureDevMembership(venueId?: string) {
  try {
    const uid = getAuth()?.currentUser?.uid;
    if (!uid) return { ok: false, reason: 'no_uid' };

    const db = getFirestore();
    const v = venueId || DEV_VENUE;
    const memRef = doc(db, 'venues', v, 'members', uid);
    await setDoc(memRef, {
      uid,
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'devBootstrap.ensureDevMembership',
    }, { merge: true });

    console.log('[TallyUp DevBootstrap] ensureDevMembership ok', { uid, venueId: v });
    return { ok: true, venueId: v };
  } catch (e: any) {
    console.warn('[TallyUp DevBootstrap] ensureDevMembership failed:', e?.message || e);
    return { ok: false, reason: 'error', error: e?.message || String(e) };
  }
}

/** Some code calls this; keep a harmless stub that returns ok */
export async function ensureActiveSession() {
  return { ok: true, reason: 'noop' };
}

const devBootstrap = { pinDevVenueIfEnvSet, ensureDevMembership, ensureActiveSession };
export default devBootstrap;
