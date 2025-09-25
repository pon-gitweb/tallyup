import { auth, db } from './firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export async function signInEmail(email: string, password: string) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function registerEmail(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  // Minimal user profile; do not set venueId here — onboarding handles venue creation/attachment
  await setDoc(doc(db, 'users', cred.user.uid), { email: cred.user.email ?? email }, { merge: true });
  return cred.user;
}

export async function signOutAll() {
  await signOut(auth);
}

// Returns true if member doc exists under the given venue
export async function hasVenueMembership(venueId: string, uid: string): Promise<boolean> {
  const m = await getDoc(doc(db, 'venues', venueId, 'members', uid));
  return m.exists();
}
