import { collection, getDocs } from 'firebase/firestore';
import { db } from 'src/services/firebase';

export type FoundItem = {
  id: string;
  name: string;
  unit?: string;
  expectedQuantity?: number;
  areaId: string;
  departmentId: string;
};

export async function searchItemsInVenue(venueId: string, term: string, limit = 20): Promise<FoundItem[]> {
  const q = (term || '').trim().toLowerCase();
  if (!venueId || !q) return [];

  const results: FoundItem[] = [];
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  for (const d of depts.docs) {
    const depId = d.id;
    const areas = await getDocs(collection(db, `venues/${venueId}/departments/${depId}/areas`));
    for (const a of areas.docs) {
      const areaId = a.id;
      const items = await getDocs(collection(db, `venues/${venueId}/departments/${depId}/areas/${areaId}/items`));
      for (const it of items.docs) {
        const data = (it.data() as any) || {};
        const name = String(data.name || it.id);
        if (name.toLowerCase().includes(q)) {
          results.push({
            id: it.id,
            name,
            unit: data.unit,
            expectedQuantity: typeof data.expectedQuantity === 'number' ? data.expectedQuantity : undefined,
            areaId,
            departmentId: depId,
          });
          if (results.length >= limit) return results;
        }
      }
    }
  }
  return results;
}
