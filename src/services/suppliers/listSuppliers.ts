import { getFirestore, collection, getDocs } from 'firebase/firestore';

export async function listSuppliers(venueId: string): Promise<Array<{id:string; name:string}>> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const out: Array<{id:string; name:string}> = [];
  snap.forEach(doc => {
    // Soft-deleted suppliers (active: false) must never surface to callers.
    // Absent field means active — mirrors the product active !== false convention.
    if ((doc.data() as any)?.active === false) return;
    out.push({ id: doc.id, name: (doc.data() as any)?.name ?? '(Unnamed)' });
  });
  return out;
}
