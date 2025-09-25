import { getFirestore, collection, getDocs } from 'firebase/firestore';

export async function listSuppliers(venueId: string): Promise<Array<{id:string; name:string}>> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const out: Array<{id:string; name:string}> = [];
  snap.forEach(doc => out.push({ id: doc.id, name: (doc.data() as any)?.name ?? '(Unnamed)' }));
  return out;
}
