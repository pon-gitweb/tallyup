// src/services/products.ts
// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, query, orderBy, limit as fblimit, where,
  getDocs, startAt, endAt, addDoc, doc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import type { Product as FullProduct } from '../types/Product';

export type ProductRow = {
  id: string;
  name?: string | null;
  supplierId?: string | null;
  active?: boolean | null;
};

type ListOpts = { limit?: number; onlyActive?: boolean };

/** First page browse by supplier (ordered by name). */
export async function listProductsBySupplierPage(
  venueId: string,
  supplierId: string,
  limit: number = 50,
  onlyActive: boolean = true,
  startAfterName?: string | null
): Promise<{ items: ProductRow[]; nextCursor: string | null }> {
  if (!venueId || !supplierId) return { items: [], nextCursor: null };
  const db = getFirestore(getApp());
  let qRef = query(
    collection(db, 'venues', venueId, 'products'),
    where('supplierId', '==', supplierId),
    orderBy('name'),
    fblimit(Math.max(1, Math.min(limit, 100)))
  );
  if (startAfterName && startAfterName.length) {
    const bump = startAfterName + '\u0000';
    qRef = query(
      collection(db, 'venues', venueId, 'products'),
      where('supplierId', '==', supplierId),
      orderBy('name'),
      startAt(bump),
      fblimit(Math.max(1, Math.min(limit, 100)))
    );
  }
  // if (onlyActive) qRef = query(qRef, where('active','==',true)); // optional
  const snap = await getDocs(qRef);
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const last = items.length ? items[items.length - 1] : null;
  return { items, nextCursor: last?.name ?? null };
}

/** Supplier-scoped prefix search with pagination. */
export async function searchProductsBySupplierPrefixPage(
  venueId: string,
  supplierId: string,
  term: string,
  limit: number = 30,
  startAfterName?: string | null
): Promise<{ items: ProductRow[]; nextCursor: string | null }> {
  if (!venueId || !supplierId) return { items: [], nextCursor: null };
  const clean = (term || '').trim();
  if (!clean) return { items: [], nextCursor: null };

  const db = getFirestore(getApp());
  let qRef = query(
    collection(db, 'venues', venueId, 'products'),
    where('supplierId', '==', supplierId),
    orderBy('name'),
    startAt(clean),
    endAt(clean + '\uf8ff'),
    fblimit(Math.max(1, Math.min(limit, 50)))
  );

  if (startAfterName && startAfterName.length) {
    const bump = startAfterName + '\u0000';
    qRef = query(
      collection(db, 'venues', venueId, 'products'),
      where('supplierId', '==', supplierId),
      orderBy('name'),
      startAt(bump),
      endAt(clean + '\uf8ff'),
      fblimit(Math.max(1, Math.min(limit, 50)))
    );
  }

  const snap = await getDocs(qRef);
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const last = items.length ? items[items.length - 1] : null;
  return { items, nextCursor: last?.name ?? null };
}

/** Browse all (ordered by name). */
export async function listProducts(venueId: string, opts: ListOpts = {}): Promise<FullProduct[]> {
  const { limit = 50 } = opts;
  if (!venueId) return [];
  const db = getFirestore(getApp());
  let qRef = query(collection(db, 'venues', venueId, 'products'), orderBy('name'), fblimit(Math.max(1, Math.min(limit, 100))));
  // if (opts.onlyActive) qRef = query(qRef, where('active','==',true)); // optional
  const snap = await getDocs(qRef);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as FullProduct[];
}

/** Mutations */
export async function createProduct(venueId: string, data: Partial<FullProduct>) {
  if (!venueId) throw new Error('createProduct: venueId required');
  const db = getFirestore(getApp());
  const ref = await addDoc(collection(db, 'venues', venueId, 'products'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(venueId: string, productId: string, data: Partial<FullProduct>) {
  if (!venueId || !productId) throw new Error('updateProduct: venueId and productId required');
  const db = getFirestore(getApp());
  await updateDoc(doc(db, 'venues', venueId, 'products', productId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function upsertProduct(venueId: string, productId: string | undefined, data: Partial<FullProduct>) {
  if (productId) return updateProduct(venueId, productId, data);
  return createProduct(venueId, data);
}

export async function deleteProductById(venueId: string, productId: string) {
  if (!venueId || !productId) throw new Error('deleteProductById: venueId and productId required');
  const db = getFirestore(getApp());
  await deleteDoc(doc(db, 'venues', venueId, 'products', productId));
}

const _default = {
  listProductsBySupplierPage,
  searchProductsBySupplierPrefixPage,
  listProducts,
  createProduct,
  updateProduct,
  upsertProduct,
  deleteProductById,
};
export default _default;
