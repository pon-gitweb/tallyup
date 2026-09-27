import {
  doc, updateDoc, increment, getDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export async function incrementFullStocktakeCompleted(venueId: string): Promise<void> {
  if (!venueId) return;

  // Update venue-level counter (unchanged behaviour)
  await updateDoc(doc(db, 'venues', venueId), {
    totalStocktakesCompleted: increment(1),
  });

  // Atomically update the D-039 trial counter if the venue has an active trial.
  // Uses a transaction so the read + write are atomic and the "reaches 3" branch
  // can't race with a simultaneous stocktake on another device.
  const venueRef = doc(db, 'venues', venueId);
  const trialRef = doc(db, 'venues', venueId, 'billing', 'trialState');
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(trialRef);
      if (!snap.exists()) return;
      const data = snap.data() as any;
      if (data.status !== 'active') return;

      const newUsed: number = (data.stocktakesUsed ?? 0) + 1;
      const update: Record<string, any> = { stocktakesUsed: newUsed };
      if (newUsed >= 3) {
        update.status = 'expired';
        update.resolvedAt = serverTimestamp();
        update.resolvedReason = 'stocktake_limit';
        // Keep the denormalized flag on the venue doc in sync so the reminder
        // CF's trialStatus:'active' query drops this venue on the next run.
        tx.update(venueRef, { trialStatus: 'expired' });
      }
      tx.update(trialRef, update);
    });
  } catch (e) {
    // Non-fatal — venue counter already updated; trial counter will self-correct
    // on the next stocktake attempt via the VenueProvider snapshot.
    console.warn('[trialStocktake] trial counter update failed:', e);
  }
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
