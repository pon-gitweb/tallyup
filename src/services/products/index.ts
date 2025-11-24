// src/services/products/index.ts

// Re-export existing helpers
export * from './searchProductsLite';
export * from './updateProduct';
export * from './update';

import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';

/** Lightweight supplier-specific product shape */
export type SupplierProductLite = {
  id: string;
  name: string;
  supplierId?: string | null;
  supplierName?: string | null;
  cost?: number | null;
  packSize?: number | null;

  // Measurement model v2 (optional)
  unitModel?: 'each' | 'ml' | 'l' | 'g' | 'kg' | 'portion' | null;
  unitSize?: number | null;
  unitLabel?: string | null;
  packUnits?: number | null;
};

/**
 * Internal helper to paginate products by supplier.
 */
async function pageProductsForSupplier(opts: {
  venueId: string;
  supplierId: string;
  pageSize?: number;
  cursor?: string | null;
}): Promise<{ items: SupplierProductLite[]; nextCursor: string | null }> {
  const { venueId, supplierId, pageSize = 20, cursor = null } = opts;
  if (!venueId || !supplierId) {
    return { items: [], nextCursor: null };
  }

  const db = getFirestore(getApp());
  const colRef = collection(db, 'venues', venueId, 'products');

  let q: any = query(
    colRef,
    where('supplierId', '==', supplierId),
    orderBy('name'),
    limit(pageSize)
  );

  // Cursor support
  if (cursor) {
    try {
      const cursorSnap = await getDocs(
        query(colRef, where('__name__', '==', cursor))
      );
      const lastDoc = cursorSnap.docs[0];
      if (lastDoc) {
        q = query(
          colRef,
          where('supplierId', '==', supplierId),
          orderBy('name'),
          startAfter(lastDoc),
          limit(pageSize)
        );
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[pageProductsForSupplier] cursor failed', e);
      }
    }
  }

  const snap = await getDocs(q);
  const docs = snap.docs;

  const items: SupplierProductLite[] = docs.map((d) => {
    const data: any = d.data() || {};
    return {
      id: d.id,
      name: data.name || '',
      supplierId: data.supplierId ?? data.supplier?.id ?? null,
      supplierName: data.supplierName ?? data.supplier?.name ?? null,
      cost: Number.isFinite(data.unitCost)
        ? Number(data.unitCost)
        : Number.isFinite(data.price)
        ? Number(data.price)
        : null,
      packSize: Number.isFinite(data.packSize)
        ? Number(data.packSize)
        : null,

      // Measurement model v2 (all optional; tolerate missing fields)
      unitModel: data.unitModel ?? null,
      unitSize: Number.isFinite(data.unitSize)
        ? Number(data.unitSize)
        : null,
      unitLabel:
        typeof data.unitLabel === 'string' ? data.unitLabel : null,
      packUnits: Number.isFinite(data.packUnits)
        ? Number(data.packUnits)
        : null,
    };
  });

  const last = docs[docs.length - 1];
  const nextCursor = docs.length === pageSize && last ? last.id : null;

  return { items, nextCursor };
}

/**
 * List products for a supplier (paged, no search).
 */
export async function listProductsBySupplierPage(
  venueId: string,
  supplierId: string,
  pageSize = 20,
  _onlyActive = true,
  cursor: string | null = null
): Promise<{ items: SupplierProductLite[]; nextCursor: string | null }> {
  return pageProductsForSupplier({ venueId, supplierId, pageSize, cursor });
}

/**
 * Supplier-specific search by name prefix or substring.
 */
export async function searchProductsBySupplierPrefixPage(
  venueId: string,
  supplierId: string,
  term: string,
  pageSize = 20,
  cursor: string | null = null
): Promise<{ items: SupplierProductLite[]; nextCursor: string | null }> {
  const t = term?.trim() || '';
  if (!t) {
    return pageProductsForSupplier({ venueId, supplierId, pageSize, cursor });
  }

  const lower = t.toLowerCase();
  const { items, nextCursor } = await pageProductsForSupplier({
    venueId,
    supplierId,
    pageSize,
    cursor,
  });

  const filtered = items.filter((p) =>
    (p.name || '').toLowerCase().includes(lower)
  );

  return { items: filtered, nextCursor };
}
