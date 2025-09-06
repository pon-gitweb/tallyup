import { getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';

export type Supplier = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export async function listSuppliers(venueId: string): Promise<Supplier[]> {
  const db = getFirestore(getApp());
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const out: Supplier[] = [];
  snap.forEach(d => {
    const s = d.data() as any;
    out.push({ id: d.id, name: s?.name ?? null, email: s?.email ?? null, phone: s?.phone ?? null });
  });
  if (!out.find(s => s.id === 'unassigned')) {
    await setDoc(doc(db, 'venues', venueId, 'suppliers', 'unassigned'), { name: 'Unassigned', system: true }, { merge: true });
    out.unshift({ id: 'unassigned', name: 'Unassigned' });
  }
  return out;
}

export async function setSupplierSmart(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName?: string
): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(
    doc(db, 'venues', venueId, 'products', productId),
    { supplierId, supplierName: supplierName ?? null, updatedAt: new Date() },
    { merge: true }
  );
}
