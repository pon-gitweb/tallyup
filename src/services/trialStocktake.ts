// @ts-nocheck
import { doc, updateDoc, increment } from 'firebase/firestore';
import { db } from './firebase';

export async function incrementFullStocktakeCompleted(venueId: string): Promise<void> {
  if (!venueId) return;
  await updateDoc(doc(db, 'venues', venueId), {
    totalStocktakesCompleted: increment(1),
  });
}
