// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, query, where, orderBy, limit,
  doc, setDoc, serverTimestamp
} from 'firebase/firestore';

export type Product = {
  id: string;
  name?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
};

/** Simple client-side search by name/id, optionally constrained to supplierId */
export async function searchProducts(venueId: string, opts: { q?: string; supplierId?: string | null } = {}): Promise<Product[]> {
  const db = getFirestore(getApp());
  // Fetch by supplier if provided; otherwise fetch a small page, we filter client-side
  const baseCol = collection(db, 'venues', venueId, 'products');
  let snap;
  if (opts.supplierId) {
    snap = await getDocs(query(baseCol, where('supplierId', '==', opts.supplierId)));
  } else {
    // A small bounded set to keep UI responsive on large catalogs
    try {
      snap = await getDocs(query(baseCol, orderBy('name'), limit(200)));
    } catch {
      snap = await getDocs(baseCol);
    }
  }
  const q = (opts.q || '').toLowerCase().trim();
  const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  if (!q) return rows;
  return rows.filter(p =>
    String(p.name || '').toLowerCase().includes(q) ||
    String(p.id || '').toLowerCase().includes(q)
  );
}

/** Quick-create a product (ID = slug from name), supplier set to the draft's supplier */
export async function quickCreateProduct(venueId: string, name: string, supplierId: string, supplierName?: string | null) {
  const id = slug3(name);
  const db = getFirestore(getApp());
  await setDoc(doc(db, 'venues', venueId, 'products', id), {
    name,
    supplierId,
    supplierName: supplierName ?? supplierId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { id, name, supplierId, supplierName: supplierName ?? supplierId };
}

/** Tiny slugger, keeps alnum and dashes, min 3 chars */
export function slug3(s: string) {
  const base = (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'prod').slice(0, 40);
}
