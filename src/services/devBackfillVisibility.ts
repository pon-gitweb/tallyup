import { collection, doc, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function backfillDeptAreaVisibility(venueId: string) {
  let deptUpdated = 0, areasUpdated = 0, itemsUpdated = 0;

  // departments
  const dSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const d of dSnap.docs) {
    const ddata = d.data() as any;
    if (ddata.venueId !== venueId) {
      await updateDoc(doc(db, 'venues', venueId, 'departments', d.id), { venueId });
      deptUpdated++;
    }
    // areas
    const aSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
    for (const a of aSnap.docs) {
      const adata = a.data() as any;
      const patch: any = {};
      if (adata.venueId !== venueId) patch.venueId = venueId;
      if (adata.departmentId !== d.id) patch.departmentId = d.id;
      if (adata.active == null) patch.active = true;
      if (Object.keys(patch).length) {
        await updateDoc(doc(db, 'venues', venueId, 'departments', d.id, 'areas', a.id), patch);
        areasUpdated++;
      }

      // items (if your schema nests items under areas)
      try {
        const iSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas', a.id, 'items'));
        for (const it of iSnap.docs) {
          const idata = it.data() as any;
          const ipatch: any = {};
          if (idata.venueId !== venueId) ipatch.venueId = venueId;
          if (idata.departmentId !== d.id) ipatch.departmentId = d.id;
          if (idata.areaId !== a.id) ipatch.areaId = a.id;
          if (idata.active == null) ipatch.active = true;
          if (Object.keys(ipatch).length) {
            await updateDoc(doc(db, 'venues', venueId, 'departments', d.id, 'areas', a.id, 'items', it.id), ipatch);
            itemsUpdated++;
          }
        }
      } catch { /* area has no items subcollection — ignore */ }
    }
  }

  return { deptUpdated, areasUpdated, itemsUpdated };
}
