import {
  collectionGroup, doc, documentId, getDoc, getDocs, query,
  setDoc, serverTimestamp, where
} from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { ensureVenueAndMembership } from 'src/services/membership';
import { createJoinAndSeedDevVenue } from 'src/services/venues';

export async function findAnyMemberVenueId(uid: string): Promise<string | null> {
  const q = query(collectionGroup(db, 'members'), where(documentId(), '==', uid));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const first = snap.docs[0]; // venues/{venueId}/members/{uid}
  const parts = first.ref.path.split('/');
  const idx = parts.indexOf('venues');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

/**
 * Attach a venue for the user.
 * Strategy:
 *   1) If users/{uid}.venueId exists → ensure membership → set sessions/current idle → return { venueId }.
 *   2) Else try to find a venue by membership → write users/{uid}.venueId → ensure membership → set session idle → return.
 *   3) Else if allowAutoCreate → create dev venue, join+seed, set profile+session idle → return.
 *   4) Else throw { code: 'NO_VENUE_FOUND' } so UI can offer Create Venue without regressing flow.
 */
export async function attachVenueForUser(uid: string, allowAutoCreate: boolean) {
  if (!uid) throw new Error('Missing uid');

  const ur = doc(db, `users/${uid}`);
  const us = await getDoc(ur);
  const u = (us.data() as any) || {};

  const attach = async (venueId: string) => {
    await ensureVenueAndMembership(venueId, uid);
    await setDoc(doc(db, `venues/${venueId}/sessions/current`), { status: 'idle' }, { merge: true });
    return { venueId };
  };

  if (typeof u.venueId === 'string' && u.venueId) {
    return attach(u.venueId);
  }

  const found = await findAnyMemberVenueId(uid);
  if (found) {
    await setDoc(ur, { venueId: found }, { merge: true });
    return attach(found);
  }

  if (allowAutoCreate) {
    const newId = await createJoinAndSeedDevVenue(uid);
    await setDoc(ur, { venueId: newId }, { merge: true });
    await ensureVenueAndMembership(newId, uid);
    await setDoc(doc(db, `venues/${newId}/sessions/current`), { status: 'idle', createdAt: serverTimestamp() }, { merge: true });
    return { venueId: newId };
  }

  const err: any = new Error('No venue found for this user');
  err.code = 'NO_VENUE_FOUND';
  throw err;
}
