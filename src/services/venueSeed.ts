import { collection, doc, setDoc, serverTimestamp, writeBatch, getDocs } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Seed a venue with default departments & areas.
 * Idempotent: if any department exists, this is a no-op.
 */
export async function seedVenueStructureIfEmpty(venueId: string) {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  if (!deptsSnap.empty) return { seeded: false };

  const batch = writeBatch(db);
  const now = serverTimestamp();

  const defaults: Array<{ id: string; name: string; areas: Array<{ id: string; name: string }> }> = [
    {
      id: 'bar',
      name: 'Bar',
      areas: [
        { id: 'front_bar', name: 'Front Bar' },
        { id: 'back_bar',  name: 'Back Bar'  },
      ],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      areas: [
        { id: 'dry_store', name: 'Dry Store' },
        { id: 'cool_room', name: 'Cool Room' },
      ],
    },
  ];

  for (const d of defaults) {
    const dRef = doc(db, 'venues', venueId, 'departments', d.id);
    batch.set(dRef, { name: d.name, active: true, createdAt: now, completedAt: null });

    for (const a of d.areas) {
      const aRef = doc(db, 'venues', venueId, 'departments', d.id, 'areas', a.id);
      batch.set(aRef, { name: a.name, startedAt: null, completedAt: null, createdAt: now });
    }
  }

  await batch.commit();
  return { seeded: true };
}
