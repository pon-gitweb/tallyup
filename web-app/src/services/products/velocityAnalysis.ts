import { type ProdEntry, resolveProduct } from './resolveProduct'

/**
 * Minimum fields that computeVelocity needs from each snapshot item.
 * A superset of this (e.g. allItems in AnalysisTab) is structurally
 * compatible and can be passed directly.
 */
export type VelocityItem = {
  name: string
  productId: string | null
  supplierName: string | null
  actualClosing: number
  cycleNumber: number
}

export type VelocityRow = {
  name: string
  supplier: string
  unitsPerWeek: number
  trend: 'rising' | 'stable' | 'falling'
  confidence: string
}

/**
 * Group snapshot items by canonical product identity and compute velocity /
 * trend for each product across its full history.
 *
 * Grouping key priority:
 *   1. Resolved survivor id   — when productId is present and the merge chain
 *      terminates at an active product.  All cycles for this product land in
 *      one bucket regardless of what name was stamped at each point in time,
 *      so a mid-history rename does NOT split the series.
 *   2. Raw productId          — when productId is present but the chain is
 *      unresolvable (deleted with no forward pointer).  Using the raw id keeps
 *      the series together under a unique key without merging it with an
 *      unrelated product that happens to share the same name.
 *   3. Raw name               — only when productId is genuinely absent
 *      (snapshots old enough to pre-date productId being stamped).
 *
 * Display name:  current live name from prodById, falling back to the most
 * recent stamped name from the snapshot series (covers deleted products and
 * the name-only fallback path).
 */
export function computeVelocity(
  items: VelocityItem[],
  prodById: Record<string, ProdEntry>,
): VelocityRow[] {
  type SnapEntry = {
    qty: number
    cycleNumber: number
    supplier: string | null
    stampedName: string
  }

  const productSnapshots = new Map<string, SnapEntry[]>()

  for (const it of items) {
    let groupKey: string
    if (it.productId) {
      const resolved = resolveProduct(it.productId, prodById)
      // resolved?.id     — active survivor (possibly after following a merge chain)
      // it.productId     — fallback: deleted product, keep its history uniquely grouped
      groupKey = resolved?.id ?? it.productId
    } else {
      // Genuinely absent productId — name-based grouping (legacy fallback)
      if (!it.name) continue
      groupKey = it.name
    }
    const existing = productSnapshots.get(groupKey) ?? []
    existing.push({
      qty: it.actualClosing,
      cycleNumber: it.cycleNumber,
      supplier: it.supplierName,
      stampedName: it.name,
    })
    productSnapshots.set(groupKey, existing)
  }

  const velocityRows: VelocityRow[] = []

  productSnapshots.forEach((snaps, groupKey) => {
    if (snaps.length < 2) return

    const sorted = [...snaps].sort((a, b) => a.cycleNumber - b.cycleNumber)

    // Live name from products catalogue when available; most recent stamped name otherwise.
    // This guarantees the row always shows the current canonical name, not whichever
    // name happened to be stamped on the oldest or newest snapshot in the series.
    const displayName = prodById[groupKey]?.name ?? sorted[sorted.length - 1].stampedName

    const diffs: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      diffs.push(sorted[i - 1].qty - sorted[i].qty)
    }

    const avgConsumed = diffs.reduce((s, d) => s + d, 0) / diffs.length
    const unitsPerWeek = avgConsumed / 2 // approximate: assume 2 weeks between stocktakes

    const trend: 'rising' | 'stable' | 'falling' =
      diffs.length >= 2
        ? diffs[diffs.length - 1] > diffs[0] * 1.2
          ? 'rising'
          : diffs[diffs.length - 1] < diffs[0] * 0.8
            ? 'falling'
            : 'stable'
        : 'stable'

    const confidence =
      sorted.length >= 5 ? 'High' : sorted.length >= 3 ? 'Medium' : 'Low'

    velocityRows.push({
      name: displayName,
      supplier: sorted[sorted.length - 1].supplier || '—',
      unitsPerWeek: Math.max(0, unitsPerWeek),
      trend,
      confidence,
    })
  })

  return velocityRows
}
