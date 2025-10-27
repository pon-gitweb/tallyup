// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, doc, getDoc, getDocs,
  query, orderBy, startAt, endAt, limit
} from 'firebase/firestore';

export type CatalogHit = {
  supplierGlobalId: string;     // e.g. "tickety-boo"
  supplierName: string;         // display label (doc.data().name or doc.id prettified)
  externalSku?: string | null;
  name: string;
  size?: string | null;         // e.g. "700ml"
  abv?: number | null;          // %
  unit?: string | null;         // "bottle" | "rtd" | "keg" | "bib" | etc
  unitsPerCase?: number | null; // pack size
  priceBottleExGst?: number | null;
  priceCaseExGst?: number | null;
  gstPercent?: number | null;
  category?: string | null;
  notes?: string | null;
};

const num = (v:any)=> {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (s:any)=> typeof s==='string' ? s.trim() : '';

/** Count of suppliers available in global catalog (for badges). */
export async function countGlobalSuppliers(): Promise<number> {
  const db = getFirestore(getApp());
  const snap = await getDocs(collection(db, 'global_suppliers'));
  return snap.size || 0;
}

/**
 * Prefix search across ALL suppliers’ items by name.
 * Strategy: fetch all suppliers (usually small), for each one do a small prefix window on `name`.
 * Limit is applied per supplier but we cap total results client-side too.
 *
 * NOTE: global catalog item fields are the normalized CSV headers we imported.
 */
export async function searchGlobalCatalogByNamePrefix(
  term: string,
  perSupplierLimit: number = 10,
  totalLimit: number = 40
): Promise<CatalogHit[]> {
  const t = clean(term);
  if (!t) return [];

  const db = getFirestore(getApp());
  const suppliers = await getDocs(collection(db, 'global_suppliers'));
  if (suppliers.empty) return [];

  const all: CatalogHit[] = [];
  for (const sup of suppliers.docs) {
    const supplierGlobalId = sup.id;
    const supplierName = (sup.data() as any)?.name || supplierGlobalId;

    // items are under global_suppliers/{id}/items with a `name` field
    const qRef = query(
      collection(db, 'global_suppliers', supplierGlobalId, 'items'),
      orderBy('name'),
      startAt(t),
      endAt(t + '\uf8ff'),
      limit(Math.max(1, Math.min(perSupplierLimit, 25)))
    );
    const items = await getDocs(qRef);
    items.forEach(d => {
      const v:any = d.data() || {};
      all.push({
        supplierGlobalId,
        supplierName,
        externalSku: clean(v.externalSku || ''),
        name: clean(v.name || ''),
        size: clean(v.size || ''),
        abv: num(v.abv),
        unit: clean(v.unit || ''),
        unitsPerCase: num(v.unitsPerCase),
        priceBottleExGst: num(v.priceBottleExGst),
        priceCaseExGst: num(v.priceCaseExGst),
        gstPercent: num(v.gstPercent),
        category: clean(v.category || ''),
        notes: clean(v.notes || '')
      });
    });

    if (all.length >= totalLimit) break;
  }

  // Soft sort: name match strength then price if present
  all.sort((a,b)=>{
    const an = a.name.toLowerCase().indexOf(t.toLowerCase());
    const bn = b.name.toLowerCase().indexOf(t.toLowerCase());
    if (an !== bn) return an - bn;
    const ap = a.priceBottleExGst ?? Number.POSITIVE_INFINITY;
    const bp = b.priceBottleExGst ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  return all.slice(0, totalLimit);
}

/**
 * Convert a CatalogHit to a patch you can merge into your product form state.
 * We DO NOT set venue-level supplierId here — we only provide `supplierNameSuggested`
 * (because global supplier ids differ from venue’s suppliers).
 */
export function catalogHitToProductPatch(hit: CatalogHit) {
  const packSize = hit.unitsPerCase ?? null;
  const unitCost = hit.priceBottleExGst ?? null;

  return {
    // identity-ish
    name: hit.name || '',
    sku: hit.externalSku || null,

    // packaging
    unit: hit.unit || null,           // "bottle" | "rtd" | ...
    size: hit.size || null,           // "700ml"
    packSize,                         // numeric

    // product attributes
    abv: hit.abv ?? null,             // %

    // costs (venue may override later)
    costPrice: unitCost,              // ex GST
    gstPercent: hit.gstPercent ?? 15, // default 15 if missing

    // hints only (not authoritative links)
    supplierNameSuggested: hit.supplierName || '',
    supplierGlobalId: hit.supplierGlobalId || '',

    // optional category hint
    categorySuggested: hit.category || '',
  };
}
