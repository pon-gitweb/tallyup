import { auth, db } from './firebase';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

// Simple venueId generator: v_{12 lowercase alnum}
function genVenueId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'v_';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * Create a new venue owned by the current user.
 * IMPORTANT: Requires the rules addition provided in the instructions to allow creating /venues/{venueId}.
 */
export async function createVenueOwnedByCurrentUser(name: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const uid = user.uid;
  const venueId = genVenueId();

  // 1) Create the venue doc (rules: allow create if ownerUid == uid and doc doesn't exist)
  const vRef = doc(db, 'venues', venueId);
  const exists = await getDoc(vRef);
  if (exists.exists()) throw new Error('Generated venue ID collided; please retry.');

  await setDoc(vRef, {
    name: name || venueId,
    ownerUid: uid,
    archived: false,
    createdAt: serverTimestamp(),
  });

  // 2) Attach user to this venue (this satisfies hasVenueAccess for subsequent writes)
  const uRef = doc(db, 'users', uid);
  await setDoc(uRef, { venueId }, { merge: true });

  // 3) Create membership doc (now allowed)
  const mRef = doc(db, 'venues', venueId, 'members', uid);
  await setDoc(mRef, { uid, role: 'owner', attachedAt: serverTimestamp() }, { merge: true });

  // 4) Seed a session doc to idle
  const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
  await setDoc(sRef, { status: 'idle', createdAt: serverTimestamp() }, { merge: true });

  return { venueId };
}
