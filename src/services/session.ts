import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

export async function resetVenueCycle(venueId: string) {
  const dSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const batch = writeBatch(db);

  for (const d of dSnap.docs) {
    const aSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
    for (const a of aSnap.docs) {
      batch.set(doc(db, 'venues', venueId, 'departments', d.id, 'areas', a.id), {
        cycleResetAt: serverTimestamp(),
        startedAt: null,
        completedAt: null,
      }, { merge: true });
    }
  }
  await batch.commit();
}
