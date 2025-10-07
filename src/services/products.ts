// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, query, orderBy, limit as fblimit, where,
  getDocs, startAt, endAt
} from 'firebase/firestore';

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
  // For cursor, we use name-based “startAt next value” pagination.
  if (startAfterName && startAfterName.length) {
    // move past previous name by starting at a string just after it
    const bump = startAfterName + '\u0000';
    qRef = query(
      collection(db, 'venues', venueId, 'products'),
      where('supplierId', '==', supplierId),
      orderBy('name'),
      startAt(bump),
      fblimit(Math.max(1, Math.min(limit, 100)))
    );
  }
  if (onlyActive) {
    // If you add this filter, you will need index: supplierId ASC, active ASC, name ASC
    // qRef = query(qRef, where('active', '==', true));
  }
  const snap = await getDocs(qRef);
  const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const last = items.length ? items[items.length - 1] : null;
  return { items, nextCursor: last?.name ?? null };
}

/**
 * Supplier-scoped prefix search with pagination.
 * Uses orderBy('name') + startAt(term) + endAt(term+'\uf8ff') limited by `limit`.
 * Cursor is the last `name` from previous page (same term).
 *
 * Required composite index (one-time):
 *   Collection group: products
 *   Fields: supplierId ASC, name ASC
 */
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

  // Base query for first page
  let qRef = query(
    collection(db, 'venues', venueId, 'products'),
    where('supplierId', '==', supplierId),
    orderBy('name'),
    startAt(clean),
    endAt(clean + '\uf8ff'),
    fblimit(Math.max(1, Math.min(limit, 50)))
  );

  // For “next pages”, we start just after the last name we’ve already shown, but keep the same prefix window.
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

// (Kept for any other callers that used these before)
export async function listProducts(venueId: string, opts: ListOpts = {}): Promise<ProductRow[]> {
  const { limit = 50, onlyActive = true } = opts;
  if (!venueId) return [];
  const db = getFirestore(getApp());
  let qRef = query(collection(db, 'venues', venueId, 'products'), orderBy('name'), fblimit(Math.max(1, Math.min(limit, 100))));
  if (onlyActive) {
    // qRef = query(qRef, where('active', '==', true));
  }
  const snap = await getDocs(qRef);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

const _default = { listProductsBySupplierPage, searchProductsBySupplierPrefixPage, listProducts };
export default _default;
