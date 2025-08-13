import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';

export async function seedVenueDefaults(venueId: string) {
  if (!venueId) throw new Error('Missing venueId');

  // If there are any departments, do nothing (idempotent)
  const deptsSnap = await getDocs(collection(db, `venues/${venueId}/departments`));
  if (!deptsSnap.empty) return;

  const departments = [
    { id: 'Bar', name: 'Bar' },
    { id: 'Kitchen', name: 'Kitchen' },
  ];

  for (const d of departments) {
    await setDoc(doc(db, `venues/${venueId}/departments/${d.id}`), {
      name: d.name, createdAt: serverTimestamp(),
    }, { merge: true });

    const areas = d.id === 'Bar'
      ? [{ id: 'FrontBar', name: 'Front Bar' }, { id: 'BackBar', name: 'Back Bar' }]
      : [{ id: 'Prep', name: 'Prep' }, { id: 'Pass', name: 'Pass' }];

    for (const a of areas) {
      await setDoc(doc(db, `venues/${venueId}/departments/${d.id}/areas/${a.id}`), {
        name: a.name, startedAt: null, completedAt: null, createdAt: serverTimestamp(),
      }, { merge: true });

      // Simple starter items
      const defaultItems = [
        { id: 'Coke330', name: 'Coke 330ml', expectedQuantity: 24, unit: 'bottles' },
        { id: 'Lime', name: 'Lime', expectedQuantity: 30, unit: 'pcs' },
      ];
      for (const it of defaultItems) {
        await setDoc(doc(db, `venues/${venueId}/departments/${d.id}/areas/${a.id}/items/${it.id}`), it, { merge: true });
      }
    }
  }
}
