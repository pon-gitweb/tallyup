import { getFirestore, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

export type ProductLite = {
  id: string;
  name: string;
  // common metadata we try to keep on products
  defaultUnit?: 'ml'|'g'|'each'|null;
  packSizeMl?: number|null;
  packSizeG?: number|null;
  packEach?: number|null;
  // venue supplier price (we'll prefer this if you store per-supplier prices)
  price?: number|null;
};

export async function searchProductsLite(venueId: string, term: string, take: number = 12): Promise<ProductLite[]> {
  const db = getFirestore(getApp());
  if (!venueId || !term?.trim()) return [];

  // Simple name contains match (you likely have better name indexes; adapt as needed)
  const col = collection(db, 'venues', venueId, 'products');
  // If you have a lowerName field/index, switch to where('lowerName','>=',...) patterns.
  const q = query(col, orderBy('name'), limit(take));
  const snap = await getDocs(q);

  const lower = term.trim().toLowerCase();

  const out: ProductLite[] = [];
  snap.forEach(doc => {
    const d = doc.data() as any;
    if ((d?.name || '').toLowerCase().includes(lower)) {
      out.push({
        id: doc.id,
        name: d?.name || '',
        defaultUnit: d?.defaultUnit ?? null,
        packSizeMl: d?.packSizeMl ?? null,
        packSizeG: d?.packSizeG ?? null,
        packEach: d?.packEach ?? null,
        price: d?.price ?? null
      });
    }
  });
  return out;
}
