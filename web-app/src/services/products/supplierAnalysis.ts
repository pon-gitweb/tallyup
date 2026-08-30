/**
 * Pure supplier-spend aggregation for the AnalysisTab.
 *
 * Extracted from the inline AnalysisTab logic so it can be unit-tested without
 * Firebase or React.
 *
 * Grouping key priority (same "honest split" principle as Handoff 3):
 *   1. supplierId — when the snapshot item has a stamped supplier id (post-fix
 *      data from snapshotWriter.ts Part A), the bucket is keyed by id.
 *   2. supplierName — name-only fallback for items that pre-date the supplierId
 *      stamp.  Items in this bucket will NOT be merged with an id-keyed bucket
 *      even if they appear to refer to the same supplier — that would require
 *      guessing a link that was never captured, which conflicts with the system's
 *      principle of not rewriting history.  The correct outcome is two separate
 *      rows until enough post-fix data accumulates under the id.
 */

export type SpendItem = {
  supplierId: string | null
  supplierName: string | null
  actualClosing: number
  costPrice: number | null
  displayCostPrice: number | null
}

export type SupplierSpendRow = {
  supplier: string
  total: number
  count: number
  avgCost: number
}

/**
 * Group items by canonical supplier key and compute total stock value, product
 * count, and average cost price per supplier.
 *
 * Returns unsorted rows — caller is responsible for sorting and slicing.
 */
export function computeSupplierSpend(items: SpendItem[]): SupplierSpendRow[] {
  type Bucket = { name: string; total: number; count: number; costs: number[] }
  const supplierMap = new Map<string, Bucket>()

  for (const it of items) {
    // Phase W2: prefer display-preferred cost price (invoice_verified items
    // would otherwise be excluded entirely).
    const effectiveCostPrice = it.displayCostPrice ?? it.costPrice
    if ((!it.supplierId && !it.supplierName) || !effectiveCostPrice) continue

    // Namespace the key so id-keyed and name-keyed buckets never accidentally
    // collide — a supplier id could theoretically look like a name string.
    const key = it.supplierId ? `id:${it.supplierId}` : `name:${it.supplierName!}`

    const existing = supplierMap.get(key) ?? {
      // Display name: supplier name when available, fall back to id string.
      name: it.supplierName ?? it.supplierId ?? key,
      total: 0,
      count: 0,
      costs: [],
    }
    existing.total += it.actualClosing * effectiveCostPrice
    existing.count++
    existing.costs.push(effectiveCostPrice)
    supplierMap.set(key, existing)
  }

  return Array.from(supplierMap.values()).map(v => ({
    supplier: v.name,
    total: v.total,
    count: v.count,
    avgCost: v.costs.reduce((s, c) => s + c, 0) / v.costs.length,
  }))
}
