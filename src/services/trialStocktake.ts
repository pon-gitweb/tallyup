// @ts-nocheck
import { doc, updateDoc, increment, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function incrementFullStocktakeCompleted(venueId: string): Promise<void> {
  if (!venueId) return;
  await updateDoc(doc(db, 'venues', venueId), {
    totalStocktakesCompleted: increment(1),
  });
}

export async function hasExistingBaseline(venueId: string): Promise<boolean> {
  if (!venueId) return false;
  try {
    const snap = await getDoc(doc(db, 'venues', venueId));
    const count = snap.data()?.totalStocktakesCompleted ?? 0;
    return count > 0;
  } catch {
    return false;
  }
}
