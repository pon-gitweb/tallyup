import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';

function genId() {
  return 'v_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function isMember(venueId: string, uid: string) {
  if (!venueId || !uid) return false;
  const mr = doc(db, `venues/${venueId}/members/${uid}`);
  return (await getDoc(mr)).exists();
}

export async function joinOpenSignup(venueId: string, uid: string) {
  const mr = doc(db, `venues/${venueId}/members/${uid}`);
  await setDoc(mr, { role: 'admin', createdAt: serverTimestamp() }, { merge: true });
}

export async function createJoinAndSeedDevVenue(uid: string): Promise<string> {
  const venueId = genId();

  // 1) Create venue with openSignup so rules allow joining
  const vr = doc(db, `venues/${venueId}`);
  await setDoc(vr, {
    name: 'TallyUp Dev Venue',
    createdAt: serverTimestamp(),
    config: { openSignup: true },
  }, { merge: true });

  // 2) Join
  await joinOpenSignup(venueId, uid);

  // 3) Seed departments/areas/items if empty
  const deptsSnap = await getDocs(collection(db, `venues/${venueId}/departments`));
  if (deptsSnap.empty) {
    const departments = [
      { id: 'Bar', name: 'Bar' },
      { id: 'Kitchen', name: 'Kitchen' },
    ];
    for (const d of departments) {
      await setDoc(doc(db, `venues/${venueId}/departments/${d.id}`), {
        name: d.name, createdAt: serverTimestamp()
      }, { merge: true });

      const areas = d.id === 'Bar'
        ? [{ id: 'FrontBar', name: 'Front Bar' }, { id: 'BackBar', name: 'Back Bar' }]
        : [{ id: 'Prep', name: 'Prep' }, { id: 'Pass', name: 'Pass' }];

      for (const a of areas) {
        await setDoc(doc(db, `venues/${venueId}/departments/${d.id}/areas/${a.id}`), {
          name: a.name,
          startedAt: null,
          completedAt: null,
          createdAt: serverTimestamp(),
        }, { merge: true });

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

  return venueId;
}
