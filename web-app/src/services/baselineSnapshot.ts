import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Reader contract — this document shape must satisfy:
 *
 *   1. variance.ts guard (~line 126):
 *        `if (!snapshot.dataCompleteness?.hasBaseline) continue`
 *      cycle-0 must have `dataCompleteness.hasBaseline = false` so it is
 *      intentionally excluded from the variance screen.
 *
 *   2. snapshotWriter.ts (~line 219, after the > 0 change):
 *      cycle-1's prev-cycle lookup reads `snapshots/cycle-0` and uses
 *      `item.actualClosing` as openingCount for each item.
 *
 *   3. ReportsPage reads `summary?.totalStockValue`, `summary?.totalVarianceDollars ?? 0`,
 *      and `dataCompleteness?.hasPrices` — all present and null-safe below.
 *
 * If a third snapshot writer ever appears, extract a shared snapshotCore.
 */

export type BaselineResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'has-real-stocktakes' }

export async function writeBaselineSnapshot(
  venueId: string,
  deptId: string,
): Promise<BaselineResult> {
  // Amendment E: refuse if a real stocktake already exists for this department
  const existingSnap = await getDocs(
    query(
      collection(db, 'venues', venueId, 'departments', deptId, 'snapshots'),
      orderBy('cycleNumber', 'desc'),
      limit(1),
    ),
  )
  if (!existingSnap.empty) {
    const top = existingSnap.docs[0].data() as any
    if ((top.cycleNumber ?? 0) > 0) {
      return { ok: false, reason: 'has-real-stocktakes' }
    }
  }

  // Collect all items across all areas that have been counted (lastCount is a number)
  const areasSnap = await getDocs(
    collection(db, 'venues', venueId, 'departments', deptId, 'areas'),
  )
  const rawItems: Array<{
    name: string
    lastCount: number
    costPrice: number | null
    parLevel: number | null
  }> = []
  await Promise.all(
    areasSnap.docs.map(async areaDoc => {
      const itemsSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', deptId, 'areas', areaDoc.id, 'items'),
      )
      itemsSnap.docs.forEach(d => {
        const data = d.data() as any
        if (typeof data.lastCount !== 'number') return
        rawItems.push({
          name: data.name || '',
          lastCount: data.lastCount,
          costPrice: typeof data.costPrice === 'number' ? data.costPrice : null,
          parLevel: typeof data.parLevel === 'number' ? data.parLevel : null,
        })
      })
    }),
  )

  // Amendment D: refuse if no counted items — empty cycle-0 has no value and
  // would pollute the latest-snapshot slot for this department
  if (rawItems.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  // Build per-item rows — cycle-0 has no prior snapshot so openingCount is always null
  let totalStockValue = 0
  let hasPrices = false
  let pricedItemCount = 0

  const snapshotItems = rawItems.map(item => {
    const lineValue = item.costPrice != null ? item.lastCount * item.costPrice : null
    if (lineValue != null) {
      totalStockValue += lineValue
      hasPrices = true
      pricedItemCount++
    }
    return {
      name: item.name,
      openingCount: null,
      actualClosing: item.lastCount,
      costPrice: item.costPrice,
      parLevel: item.parLevel,
      belowPAR: item.parLevel != null ? item.lastCount < item.parLevel : false,
      totalVarianceQty: null,
      totalVarianceDollars: null,
      unexplainedVarianceQty: null,
      unexplainedVarianceDollars: null,
    }
  })

  const pricedItemPercent = Math.round((pricedItemCount / rawItems.length) * 100)

  const batch = writeBatch(db)

  // Write cycle-0 snapshot document
  batch.set(
    doc(db, 'venues', venueId, 'departments', deptId, 'snapshots', 'cycle-0'),
    {
      venueId,
      departmentId: deptId,
      cycleNumber: 0,
      isBaseline: true,
      completedAt: serverTimestamp(),
      requiresRecalculation: false,
      lastRecalculatedAt: serverTimestamp(),
      completedBy: null,
      completedByName: null,
      cycleStart: null,
      cycleEnd: serverTimestamp(),
      daysSinceLastCycle: null,
      durationMinutes: 0,
      // Shape must match snapshotWriter.ts — see reader contract above
      dataCompleteness: {
        hasBaseline: false,
        hasInvoices: false,
        hasSales: false,
        hasRecipes: false,
        hasWastage: false,
        hasPrices,
        tier: 1,
        pricedItemPercent,
        invoiceCoverage: 0,
        salesCoverage: 0,
      },
      summary: {
        totalItemsCounted: snapshotItems.length,
        totalItemsWithVariance: 0,
        totalStockValue: hasPrices ? totalStockValue : null,
        totalVarianceQty: null,
        totalVarianceDollars: null,
        unexplainedVarianceQty: null,
        unexplainedVarianceDollars: null,
        itemsBelowPAR: snapshotItems.filter(i => i.belowPAR).length,
        itemsAtZero: snapshotItems.filter(i => i.actualClosing === 0).length,
        itemsWithNoPrice: snapshotItems.filter(i => i.costPrice == null).length,
        itemsWithPositiveVariance: 0,
        itemsWithNegativeVariance: 0,
      },
      items: snapshotItems,
      findings: {
        likelyMissingInvoices: [],
        poDiscrepancies: [],
        recipeAnomalies: [],
        patterns: [],
        recommendations: [],
      },
    },
  )

  // Amendment B: set lastCycleAt so the invoice/sales window opens from this baseline
  // moment for cycle-1. totalCyclesCompleted is intentionally left at 0 — that is what
  // makes the first real stocktake compute as cycle 1 (not cycle 2).
  batch.update(doc(db, 'venues', venueId, 'departments', deptId), {
    lastCycleAt: serverTimestamp(),
  })

  await batch.commit()
  return { ok: true }
}
