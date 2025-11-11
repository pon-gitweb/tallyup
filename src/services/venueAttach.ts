import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * Ensure the signed-in user has a member doc under their venue.
 * This avoids collectionGroup() which is blocked by our rules.
 *
 * Rules permit:
 *   - read users/{uid} (self)
 *   - read/write venues/{venueId}/members/{uid} for owner/manager
 */
export async function ensureDevMembership(db: Firestore, uid: string) {
  // 1) Find venueId from the user document (self-readable by rules)
  const uref = doc(db, 'users', uid);
  const u = await getDoc(uref);
  const venueId = u.data()?.venueId as string | undefined;
  if (!venueId) {
    throw new Error('[venueAttach] No venueId on user document');
  }

  // 2) Read the member doc directly (rules: allow read if isVenueMember)
  const mref = doc(db, 'venues', venueId, 'members', uid);
  const m = await getDoc(mref);
  if (m.exists()) {
    return { venueId, ...m.data() };
  }

  // 3) Dev bootstrap path (matches your rules + prior behavior)
  const now = serverTimestamp();
  await setDoc(
    mref,
    {
      uid,
      role: 'owner',
      status: 'active',
      dev: true,
      joinedAt: now,
      attachedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  const m2 = await getDoc(mref);
  return { venueId, ...m2.data() };
}
