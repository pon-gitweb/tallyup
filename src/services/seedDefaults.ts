import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { path } from './firestorePaths';

export async function seedVenueIfEmpty(venueId: string) {
  if (!venueId) return;
  const deptsSnap = await getDocs(collection(db, path.departments(venueId)));
  if (!deptsSnap.empty) return;

  const departments = [
    { id: 'Bar', name: 'Bar' },
    { id: 'Kitchen', name: 'Kitchen' },
  ];

  for (const d of departments) {
    await setDoc(doc(db, path.department(venueId, d.id)), { name: d.name });
    const areas =
      d.id === 'Bar'
        ? [
            { id: 'FrontBar', name: 'Front Bar' },
            { id: 'BackBar', name: 'Back Bar' },
          ]
        : [
            { id: 'Prep', name: 'Prep' },
            { id: 'Pass', name: 'Pass' },
          ];

    for (const a of areas) {
      await setDoc(doc(db, path.area(venueId, d.id, a.id)), {
        name: a.name,
        startedAt: null,
        completedAt: null,
      });

      const defaultItems = [
        { id: 'Coke330', name: 'Coke 330ml', expectedQuantity: 24, unit: 'bottles' },
        { id: 'Lime', name: 'Lime', expectedQuantity: 30, unit: 'pcs' },
      ];
      for (const it of defaultItems) {
        await setDoc(doc(db, path.item(venueId, d.id, a.id, it.id)), it, { merge: true });
      }
    }
  }
}
