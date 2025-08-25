import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function getSetupCompleted(venueId: string): Promise<boolean> {
  const ref = doc(db, 'venues', venueId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any)?.setupCompleted === true : false;
}

export async function setSetupCompleted(venueId: string, done: boolean) {
  const ref = doc(db, 'venues', venueId);
  await updateDoc(ref, { setupCompleted: !!done });
}
