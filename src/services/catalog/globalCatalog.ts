import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase'; // adjust if your firebase export path differs

export type CatalogItem = {
  supplier: string;            // e.g. "Tickety Boo"
  name: string;
  size?: string;               // "700ml"
  abv?: number;
  unit?: string;               // "bottle" | "bib" | ...
  unitsPerCase?: number;
  priceBottleExGst?: number;
  priceCaseExGst?: number;
  gstPercent?: number;
};

export async function listSupplierItems(supplierSlug: string): Promise<CatalogItem[]> {
  const col = collection(db, 'global_suppliers', supplierSlug, 'items');
  const snap = await getDocs(query(col));
  return snap.docs.map(d => d.data() as CatalogItem);
}

// Fetch across multiple suppliers (simple fan-out; refine later with indexed fields)
export async function listAllItemsFromSuppliers(supplierSlugs: string[]): Promise<CatalogItem[]> {
  const chunks: CatalogItem[][] = [];
  for (const slug of supplierSlugs) {
    chunks.push(await listSupplierItems(slug));
  }
  return chunks.flat();
}

// A naive match: exact normalized name (+ optional size if provided)
export type MatchKey = { name: string; size?: string | null };

export function chooseCheapest(items: CatalogItem[]) {
  const withUnitPrice = items
    .map(i => {
      const unitPrice = i.priceBottleExGst ??
        (i.priceCaseExGst && i.unitsPerCase ? i.priceCaseExGst / i.unitsPerCase : undefined);
      return unitPrice ? { ...i, unitPrice } : null;
    })
    .filter(Boolean) as (CatalogItem & { unitPrice: number })[];

  withUnitPrice.sort((a, b) => a.unitPrice - b.unitPrice);
  return withUnitPrice[0] ?? null;
}
