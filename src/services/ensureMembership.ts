import { db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Ensure venues/{venueId}/members/{uid} exists and is active.
 * - If user is the venue owner, keep role 'owner'; otherwise default to 'manager' unless a role exists.
 */
export async function ensureMembership(venueId: string, uid: string) {
  const vref = doc(db, 'venues', venueId);
  const vsnap = await getDoc(vref);
  if (!vsnap.exists()) throw new Error(`Venue ${venueId} not found`);

  const ownerUid = (vsnap.data() as any)?.ownerUid ?? null;

  const mref = doc(db, 'venues', venueId, 'members', uid);
  const msnap = await getDoc(mref);
  const existing = msnap.exists() ? msnap.data() as any : {};

  const role = existing.role || (uid === ownerUid ? 'owner' : 'manager');
  const payload = {
    role,
    status: 'active',
    dev: existing.dev ?? true,
    joinedAt: existing.joinedAt ?? serverTimestamp(),
    attachedAt: existing.attachedAt ?? serverTimestamp(),
    source: existing.source ?? 'ensureMembership',
    uid,
    updatedAt: serverTimestamp(),
  };

  await setDoc(mref, payload, { merge: true });
  return { role };
}
