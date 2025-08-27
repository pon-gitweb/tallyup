import Constants from 'expo-constants';
import { getAuth } from 'firebase/auth';
import { db } from './firebase';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';

const EXTRA: any =
  (Constants?.expoConfig?.extra as any) ??
  ((Constants as any)?.manifest2?.extra as any) ??
  {};
const DEV_VENUE_ID: string | null = (EXTRA.EXPO_PUBLIC_DEV_VENUE_ID as string) || null;
const DEV_EMAILS = new Set<string>(['test@example.com']);

function isDevEmail(email: string | null | undefined) {
  return !!email && DEV_EMAILS.has(email.toLowerCase());
}

/** Pin venue for dev account only (by email allowlist + env venue id). */
export async function pinDevVenueIfEnvSet() {
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;
  const email = auth.currentUser?.email || null;
  if (!uid || !email) return { ok: false, reason: 'missing_auth' as const };
  if (!DEV_VENUE_ID) return { ok: false, reason: 'no_dev_id' as const };
  if (!isDevEmail(email)) return { ok: false, reason: 'not_dev' as const };

  const uref = doc(db, 'users', uid);
  const snap = await getDoc(uref);
  const current = snap.exists() ? (snap.data() as any)?.venueId ?? null : null;
  if (current) return { ok: true, reason: 'noop' as const, venueId: current };

  await setDoc(uref, { venueId: DEV_VENUE_ID, touchedAt: new Date(), email }, { merge: true });
  return { ok: true, reason: 'set', venueId: DEV_VENUE_ID };
}

/** Ensure a members/{uid} doc exists so rules grant access. */
export async function ensureDevMembership(venueId?: string | null) {
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;
  if (!uid) {
    console.warn('[DevBootstrap] ensureDevMembership: missing uid');
    return { ok: false as const, reason: 'missing_uid' as const };
  }
  const vid = venueId ?? (await getCurrentVenueForUser());
  if (!vid) return { ok: true as const, reason: 'noop' as const };

  try {
    const mref = doc(db, 'venues', vid, 'members', uid);
    await setDoc(mref, { role: 'dev', createdAt: serverTimestamp() }, { merge: true });
    console.log('[TallyUp DevBootstrap] ensureDevMembership ok', JSON.stringify({ uid, venueId: vid }));
    return { ok: true as const, venueId: vid };
  } catch (e:any) {
    console.warn('[DevBootstrap] ensureDevMembership failed:', e?.message || e);
    return { ok: false as const, reason: 'rules' as const, error: e };
  }
}

/** No-op session helper preserved for compatibility. */
export async function ensureActiveSession(_venueId?: string | null) {
  return { ok: true as const, reason: 'noop' as const };
}

/** Helper some screens import: read users/{uid}.venueId */
export async function getCurrentVenueForUser(): Promise<string | null> {
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;
  if (!uid) return null;
  const uref = doc(db, 'users', uid);
  const snap = await getDoc(uref);
  return snap.exists() ? ((snap.data() as any)?.venueId ?? null) : null;
}

/**
 * Attach self to a venue by setting users/{uid}.venueId if it's currently null/absent.
 * Rules only allow setting venueId if it wasn't previously set, so we check first.
 */
export async function attachSelfToVenue(venueId: string) {
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;
  if (!uid) return { ok: false as const, reason: 'missing_uid' as const };

  const uref = doc(db, 'users', uid);
  const snap = await getDoc(uref);
  const current = snap.exists() ? (snap.data() as any)?.venueId ?? null : null;
  if (current) return { ok: true as const, reason: 'already_set' as const, venueId: current };

  try {
    await setDoc(uref, { venueId, touchedAt: new Date() }, { merge: true });
    return { ok: true as const, reason: 'set' as const, venueId };
  } catch (e:any) {
    return { ok: false as const, reason: 'rules' as const, error: e };
  }
}

/** Silent wrapper some code references; keeps logs tidy. */
export async function runDevBootstrapSilently() {
  try { await pinDevVenueIfEnvSet(); } catch {}
  try { await ensureDevMembership(); } catch {}
}

const api = {
  pinDevVenueIfEnvSet,
  ensureDevMembership,
  ensureActiveSession,
  getCurrentVenueForUser,
  attachSelfToVenue,
  runDevBootstrapSilently,
};
export default api;
