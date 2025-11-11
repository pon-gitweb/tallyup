import { db } from './firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

export type InvItem = { id: string; name?: string; sku?: string; unit?: string; packSize?: number };
export type InvArea = { id: string; name: string; items: InvItem[] };
export type InvDept = { id: string; name: string; areas: InvArea[] };

/** Read departments→areas→items under venues/{venueId}/... (no collectionGroup). */
export async function readVenueInventory(venueId: string): Promise<InvDept[]> {
  const vref = doc(db, 'venues', venueId);
  const vsnap = await getDoc(vref);
  if (!vsnap.exists()) throw new Error(`Venue ${venueId} not found`);

  const depsCol = collection(db, 'venues', venueId, 'departments');
  const depsSnap = await getDocs(depsCol);

  const result: InvDept[] = [];
  for (const d of depsSnap.docs) {
    const depId = d.id;
    const depName = (d.data() as any)?.name ?? depId;

    const areasCol = collection(db, 'venues', venueId, 'departments', depId, 'areas');
    const areasSnap = await getDocs(areasCol);

    const areas: InvArea[] = [];
    for (const a of areasSnap.docs) {
      const areaId = a.id;
      const areaName = (a.data() as any)?.name ?? areaId;

      const itemsCol = collection(db, 'venues', venueId, 'departments', depId, 'areas', areaId, 'items');
      const itemsSnap = await getDocs(itemsCol);
      const items: InvItem[] = itemsSnap.docs.map(it => ({ id: it.id, ...(it.data() as any) }));

      areas.push({ id: areaId, name: areaName, items });
    }
    result.push({ id: depId, name: depName, areas });
  }
  return result;
}
