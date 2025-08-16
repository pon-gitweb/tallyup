import { auth, db } from './firebase';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch, deleteDoc } from 'firebase/firestore';

// Generate venueId like v_xxxxxxxxxxxx
function genVenueId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'v_';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Create a new venue owned by the current user (MVP) */
export async function createVenueOwnedByCurrentUser(name: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const uid = user.uid;
  const venueId = genVenueId();

  const vRef = doc(db, 'venues', venueId);
  const exists = await getDoc(vRef);
  if (exists.exists()) throw new Error('Generated venue ID collided; please retry.');

  // 1) Create the venue doc (rules: allow create if ownerUid == uid)
  await setDoc(vRef, {
    name: name || venueId,
    ownerUid: uid,
    archived: false,
    createdAt: serverTimestamp(),
  });

  // 2) Attach the user to this venue (enables hasVenueAccess)
  const uRef = doc(db, 'users', uid);
  await setDoc(uRef, { venueId }, { merge: true });

  // 3) Membership as owner
  const mRef = doc(db, 'venues', venueId, 'members', uid);
  await setDoc(mRef, { uid, role: 'owner', attachedAt: serverTimestamp() }, { merge: true });

  // 4) Seed an idle session
  const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
  await setDoc(sRef, { status: 'idle', createdAt: serverTimestamp() }, { merge: true });

  return { venueId };
}

/** Leave the current venue (batch: delete membership + clear users/{uid}.venueId) */
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
  batch.delete(mRef);
  batch.set(uRef, { venueId: null }, { merge: true });
  await batch.commit();
  return { venueId };
}
