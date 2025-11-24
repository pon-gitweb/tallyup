// src/services/products/searchProductsLite.ts

import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';

export type ProductLite = {
  id: string;
  name: string;

  // Legacy "lite" measurement hints (kept for compatibility)
  defaultUnit?: 'ml' | 'g' | 'each' | null;
  packSizeMl?: number | null;
  packSizeG?: number | null;
  packEach?: number | null;

  // Venue supplier price (we'll prefer this if you store per-supplier prices)
  price?: number | null;

  // Measurement model v2 (optional; mirrors Product.type fields)
  unitModel?: 'each' | 'ml' | 'l' | 'g' | 'kg' | 'portion' | null;
  unitSize?: number | null;
  unitLabel?: string | null;
  packUnits?: number | null;
};

export async function searchProductsLite(
  venueId: string,
  term: string,
  take: number = 12
): Promise<ProductLite[]> {
  const db = getFirestore(getApp());
  if (!venueId || !term?.trim()) return [];

  // Simple name contains match (you likely have better name indexes; adapt as needed)
  const col = collection(db, 'venues', venueId, 'products');
  // If you have a lowerName field/index, switch to where('lowerName','>=',...) patterns.
  const q = query(col, orderBy('name'), limit(take));
  const snap = await getDocs(q);

  const lower = term.trim().toLowerCase();

  const out: ProductLite[] = [];
  snap.forEach((doc) => {
    const d = doc.data() as any;
    if ((d?.name || '').toLowerCase().includes(lower)) {
      out.push({
        id: doc.id,
        name: d?.name || '',

        // legacy hints
        defaultUnit: d?.defaultUnit ?? null,
        packSizeMl: d?.packSizeMl ?? null,
        packSizeG: d?.packSizeG ?? null,
        packEach: d?.packEach ?? null,
        price: d?.price ?? null,

        // v2 measurement model - tolerate missing fields
        unitModel: d?.unitModel ?? null,
        unitSize:
          typeof d?.unitSize === 'number' && Number.isFinite(d.unitSize)
            ? Number(d.unitSize)
            : null,
        unitLabel:
          typeof d?.unitLabel === 'string' ? d.unitLabel : null,
        packUnits:
          typeof d?.packUnits === 'number' && Number.isFinite(d.packUnits)
            ? Number(d.packUnits)
            : null,
      });
    }
  });
  return out;
}
