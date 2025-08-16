import { auth, db } from './firebase';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch, deleteDoc } from 'firebase/firestore';

// Simple venueId generator: v_{12 lowercase alnum}
function genVenueId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'v_';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Create a new venue owned by the current user.
 */
export async function createVenueOwnedByCurrentUser(name: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const uid = user.uid;
  const venueId = genVenueId();

  const vRef = doc(db, 'venues', venueId);
  const exists = await getDoc(vRef);
  if (exists.exists()) throw new Error('Generated venue ID collided; please retry.');

  await setDoc(vRef, {
    name: name || venueId,
    ownerUid: uid,
    archived: false,
    createdAt: serverTimestamp(),
  });

  // Attach user to this venue (enables hasVenueAccess)
  const uRef = doc(db, 'users', uid);
  await setDoc(uRef, { venueId }, { merge: true });

  // Create membership doc (now allowed)
  const mRef = doc(db, 'venues', venueId, 'members', uid);
  await setDoc(mRef, { uid, role: 'owner', attachedAt: serverTimestamp() }, { merge: true });

  // Seed session to idle
  const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
  await setDoc(sRef, { status: 'idle', createdAt: serverTimestamp() }, { merge: true });

  return { venueId };
}

/**
 * Leave the current venue: delete membership and clear users/{uid}.venueId.
 * Uses a single batch for atomicity.
 */
export async function leaveCurrentVenue() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const uid = user.uid;

  const uRef = doc(db, 'users', uid);
  const uSnap = await getDoc(uRef);
  const venueId = uSnap.exists() ? (uSnap.data() as any)?.venueId ?? null : null;
  if (!venueId) throw new Error('You are not attached to any venue.');

  const mRef = doc(db, 'venues', venueId, 'members', uid);

  const batch = writeBatch(db);
  batch.delete(mRef);                 // allowed while access still valid
  batch.set(uRef, { venueId: null }, { merge: true }); // always allowed (own user doc)

  await batch.commit();

  return { venueId };
}
