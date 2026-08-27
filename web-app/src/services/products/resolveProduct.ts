import { type QuerySnapshot, type DocumentData } from 'firebase/firestore';

/**
 * Shape of a venue product entry used for merge-chain resolution and
 * category/cost-price fallback. Mirrors the inline ProdEntry type in
 * StockHoldingScreen's load() function — zero logic change.
 */
export type ProdEntry = {
  name: string;
  category: string;
  costPrice?: number;
  active?: boolean;
  mergedInto?: string | null;
  /**
   * How the product's quantity basis was last established.
   * 'physical_count'        — set after a stocktake cycle-reset (most reliable).
   * 'estimated_with_sales'  — WAC engine estimate, sales data available.
   * 'estimated_no_sales'    — WAC engine estimate, no sales data.
   * undefined               — not yet set; treat the same as "estimated" for display.
   */
  quantityConfidence?: 'physical_count' | 'estimated_with_sales' | 'estimated_no_sales';
};

export type ProdMaps = {
  /** All venue products keyed by Firestore document id. */
  prodById: Record<string, ProdEntry>;
  /** Products keyed by lowercased name — fallback for items with no productId. */
  prodByName: Record<string, { category: string; costPrice?: number; quantityConfidence?: ProdEntry['quantityConfidence'] }>;
};

/**
 * Build the two product lookup maps from a venue products QuerySnapshot.
 *
 * Mirrors src/services/products/resolveProduct.ts — zero logic change.
 * Callers are expected to fetch the snapshot themselves:
 *   const prodSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
 *   const { prodById, prodByName } = buildProductMaps(prodSnap);
 */
export function buildProductMaps(prodSnap: QuerySnapshot<DocumentData>): ProdMaps {
  const prodById: Record<string, ProdEntry> = {};
  const prodByName: Record<string, { category: string; costPrice?: number }> = {};

  prodSnap.forEach(d => {
    const p = d.data() as any;
    const name = (p.name ?? '').trim();
    const entry: ProdEntry = {
      name,
      category: p.category ?? p.categorySuggested ?? 'Uncategorised',
      costPrice: typeof p.costPrice === 'number' ? p.costPrice : undefined,
      active: typeof p.active === 'boolean' ? p.active : undefined,
      mergedInto: p.mergedInto ?? null,
      quantityConfidence: p.quantityConfidence ?? undefined,
    };
    prodById[d.id] = entry;
    const nameKey = name.toLowerCase();
    if (nameKey) prodByName[nameKey] = { category: entry.category, costPrice: entry.costPrice, quantityConfidence: entry.quantityConfidence };
  });

  return { prodById, prodByName };
}

/**
 * Walk the mergedInto chain to find the active survivor product.
 *
 * Returns { id, entry } when an active product is reached, null if unresolvable.
 * Capped at 5 hops to guard against any accidental circular reference.
 *
 * Mirrors src/services/products/resolveProduct.ts — zero logic change.
 * prodById is an explicit parameter instead of a closure variable.
 */
export function resolveProduct(
  startId: string,
  prodById: Record<string, ProdEntry>,
): { id: string; entry: ProdEntry } | null {
  let id = startId;
  for (let hop = 0; hop < 5; hop++) {
    const entry = prodById[id];
    if (!entry) return null;                          // product doc missing
    if (entry.active !== false) return { id, entry }; // active (or field absent → default active)
    if (!entry.mergedInto) return null;               // inactive, no forwarding pointer
    id = entry.mergedInto;                            // follow the chain
  }
  return null; // hop cap reached without landing on an active product
}
