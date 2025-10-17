import { getApp } from 'firebase/app';
import { getFirestore, getDoc, setDoc, updateDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

/**
 * Safe, rules-compliant attach:
 * - If users/<uid> is missing -> create with { venueId }
 * - If users/<uid>.venueId is missing or null -> set it
 * - If users/<uid>.venueId is different -> NO-OP (log only)
 */
export async function attachUserToVenueIfAllowed(venueId: string) {
  try {
    const uid = getAuth().currentUser?.uid;
    if (!uid) { console.log('[AttachVenue] not signed in'); return; }
    const db = getFirestore(getApp());
    const uref = doc(db, 'users', uid);
    const snap = await getDoc(uref);

    if (!snap.exists()) {
      await setDoc(uref, { venueId }, { merge: true });
      console.log('[AttachVenue] created users/%s with venueId=%s', uid, venueId);
      return;
    }

    const current = (snap.data() as any)?.venueId ?? null;
    if (current == null) {
      await updateDoc(uref, { venueId });
      console.log('[AttachVenue] set users/%s.venueId=%s', uid, venueId);
    } else if (current === venueId) {
      console.log('[AttachVenue] users/%s already attached to %s', uid, venueId);
    } else {
      console.log('[AttachVenue] users/%s.venueId is different (%s) — not changing.', uid, String(current));
    }
  } catch (e: any) {
    console.log('[AttachVenue] error', e?.code || '', e?.message || e);
  }
}
