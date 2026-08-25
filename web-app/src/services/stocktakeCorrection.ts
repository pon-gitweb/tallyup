/**
 * Stocktake Correction Service
 *
 * Provides read-preview-commit flow for correcting actualClosing on a
 * snapshot item, rippling openingCount into the immediately-following cycle.
 *
 * All formulas mirror snapshotWriter.ts exactly — do NOT alter them here
 * without also updating the writer.
 */

import { db } from '../firebase'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DepartmentRow {
  id: string
  name: string
}

export interface CycleRow {
  cycleNumber: number
  /** e.g. "cycle-3" — the Firestore doc ID */
  snapshotId: string
  closedAt?: string | null
}

export interface SnapshotItem {
  [key: string]: any
}

/** Mirror of the figures computed by snapshotWriter.computeSnapshotItemFigures */
export interface RecalcResult {
  totalVarianceQty: number
  totalVarianceDollars: number | null
  expectedClosing: number | null
  unexplainedVarianceQty: number
  unexplainedVarianceDollars: number | null
  belowPAR: boolean
  ranToZero: boolean
  // Phase W1 — display-tier fields (carried forward from item, dollar amounts recomputed)
  costPriceTier: 'stamped' | 'invoice_verified' | 'none'
  displayCostPrice: number | null
  displayTotalVarianceDollars: number | null
  displayUnexplainedVarianceDollars: number | null
}

export interface PreviewLine {
  cycleNumber: number
  departmentId: string
  departmentName: string
  itemName: string
  before: RecalcResult
  after: RecalcResult
}

export interface CorrectionPreview {
  /** Up to two lines: target cycle first, downstream cycle (N+1) second if present */
  lines: PreviewLine[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recomputes the variant figures from snapshotWriter.ts (lines 76-172) using
 * only the numeric fields on the item.  Pass `overrides` to substitute a
 * corrected actualClosing or openingCount before recomputing.
 */
export function recalculateItem(
  item: SnapshotItem,
  overrides: Partial<{ actualClosing: number; openingCount: number | null }> = {},
): RecalcResult {
  const actualClosing: number = overrides.actualClosing ?? (item.actualClosing as number)
  const openingCount: number | null =
    'openingCount' in overrides
      ? (overrides.openingCount as number | null)
      : (item.openingCount as number | null) ?? null

  const costPrice: number | null = (item.costPrice as number | null) ?? null
  const parLevel: number | null = (item.parLevel as number | null) ?? null
  const receivedQty: number = (item.receivedQty as number) || 0
  const soldQty: number | null = (item.soldQty as number | null) ?? null

  // Pricing-tier evidence is not affected by a quantity correction — carry forward as-is
  const costPriceTier: 'stamped' | 'invoice_verified' | 'none' =
    (item.costPriceTier as 'stamped' | 'invoice_verified' | 'none') ?? 'none'
  const displayCostPrice: number | null = (item.displayCostPrice as number | null) ?? null

  // ── Base figures (snapshotWriter lines 76-108) ──────────────────────────
  const totalVarianceQty = actualClosing - (openingCount ?? 0)
  const totalVarianceDollars =
    costPrice != null ? totalVarianceQty * costPrice : null
  const displayTotalVarianceDollars =
    displayCostPrice != null ? totalVarianceQty * displayCostPrice : null

  const belowPAR = parLevel != null ? actualClosing < parLevel : false
  const ranToZero = actualClosing === 0 && (openingCount ?? 0) > 0

  // ── Post-enrichment (snapshotWriter lines 169-172) ───────────────────────
  // Only computable when openingCount is known
  let expectedClosing: number | null = null
  let unexplainedVarianceQty = totalVarianceQty
  let unexplainedVarianceDollars = totalVarianceDollars
  let displayUnexplainedVarianceDollars: number | null = null

  if (openingCount != null) {
    expectedClosing = openingCount + receivedQty - (soldQty ?? 0)
    unexplainedVarianceQty = actualClosing - expectedClosing
    unexplainedVarianceDollars =
      costPrice != null ? unexplainedVarianceQty * costPrice : null
    displayUnexplainedVarianceDollars =
      displayCostPrice != null ? unexplainedVarianceQty * displayCostPrice : null
  }

  return {
    totalVarianceQty,
    totalVarianceDollars,
    expectedClosing,
    unexplainedVarianceQty,
    unexplainedVarianceDollars,
    belowPAR,
    ranToZero,
    costPriceTier,
    displayCostPrice,
    displayTotalVarianceDollars,
    displayUnexplainedVarianceDollars,
  }
}

// ---------------------------------------------------------------------------
// Firestore reads
// ---------------------------------------------------------------------------

export async function listDepartments(venueId: string): Promise<DepartmentRow[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'departments'))
  return snap.docs
    .map((d) => ({ id: d.id, name: (d.data() as any).name ?? d.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listCycles(
  venueId: string,
  departmentId: string,
): Promise<CycleRow[]> {
  const snap = await getDocs(
    collection(db, 'venues', venueId, 'departments', departmentId, 'snapshots'),
  )
  const rows: CycleRow[] = []
  for (const d of snap.docs) {
    const match = d.id.match(/^cycle-(\d+)$/)
    if (!match) continue
    rows.push({
      cycleNumber: parseInt(match[1], 10),
      snapshotId: d.id,
      closedAt: (d.data() as any).closedAt ?? null,
    })
  }
  return rows.sort((a, b) => a.cycleNumber - b.cycleNumber)
}

/** Returns items, the snapshot ref, and the existing summary (for preserving display-tier fields). */
export async function findSnapshotItem(
  venueId: string,
  departmentId: string,
  cycleNumber: number,
): Promise<{ items: SnapshotItem[]; snapshotRef: ReturnType<typeof doc>; summary: Record<string, unknown> } | null> {
  const ref = doc(
    db,
    'venues', venueId,
    'departments', departmentId,
    'snapshots', `cycle-${cycleNumber}`,
  )
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const data = snap.data() as any
  const items: SnapshotItem[] = data.items ?? []
  const summary: Record<string, unknown> = data.summary ?? {}
  return { items, snapshotRef: ref, summary }
}

// ---------------------------------------------------------------------------
// Summary recomputation
// ---------------------------------------------------------------------------

/**
 * Exact port of snapshotWriter.ts lines 431-489 (summary-building block).
 *
 * hasPrices is derived from the items themselves — costPrice presence on each
 * item does not change when correcting a quantity, so this is stable and needs
 * no separate Firestore read.
 *
 * dataCompleteness is NOT recomputed here: all its fields (hasBaseline,
 * hasInvoices, hasSales, pricedItemPercent) depend on invoice/sales records
 * and item-count ratios that a quantity correction never touches.
 *
 * existingSummary is passed through so that Phase 1 display-tier fields
 * (pricingBackfillAppliedAt, itemsPricedByInvoice) are preserved — without
 * this, batch.update(ref, { summary }) replaces the whole map and silently
 * drops them on every snapshot a correction touches.
 */
function computeSummary(
  items: SnapshotItem[],
  existingSummary: Record<string, unknown> = {},
): Record<string, unknown> {
  const pricedItems = items.filter((it) => it.costPrice != null)
  const hasPrices = pricedItems.length > 0

  const totalStockValue = hasPrices
    ? pricedItems.reduce((s, it) => s + (it.actualClosing as number) * (it.costPrice as number), 0)
    : null
  const totalVarianceDollars = hasPrices
    ? items.reduce((s, it) => s + ((it.totalVarianceDollars as number) ?? 0), 0)
    : null
  const unexplainedVarianceDollars = hasPrices
    ? items.reduce((s, it) => s + ((it.unexplainedVarianceDollars as number) ?? 0), 0)
    : null

  // Display-tier summary — recomputed from corrected item figures
  const displayPricedItems = items.filter((it) => it.displayCostPrice != null)
  const hasDisplayPrices = displayPricedItems.length > 0

  const displayTotalStockValue = hasDisplayPrices
    ? items.reduce(
        (s, it) =>
          s + (it.displayCostPrice != null ? (it.actualClosing as number) * (it.displayCostPrice as number) : 0),
        0,
      )
    : null
  const displayTotalVarianceDollars = hasDisplayPrices
    ? items.reduce((s, it) => s + ((it.displayTotalVarianceDollars as number) ?? 0), 0)
    : null
  const displayUnexplainedVarianceDollars = hasDisplayPrices
    ? items.reduce((s, it) => s + ((it.displayUnexplainedVarianceDollars as number) ?? 0), 0)
    : null

  return {
    totalItemsCounted: items.length,
    totalItemsWithVariance: items.filter((it) => (it.totalVarianceQty as number) !== 0).length,
    totalStockValue,
    totalVarianceQty: items.reduce((s, it) => s + (it.totalVarianceQty as number), 0),
    totalVarianceDollars,
    unexplainedVarianceQty: items.reduce((s, it) => s + (it.unexplainedVarianceQty as number), 0),
    unexplainedVarianceDollars,
    itemsBelowPAR: items.filter((it) => it.belowPAR).length,
    itemsAtZero: items.filter((it) => it.actualClosing === 0).length,
    itemsWithNoPrice: items.filter((it) => it.costPrice == null).length,
    itemsWithPositiveVariance: items.filter((it) => (it.totalVarianceQty as number) > 0).length,
    itemsWithNegativeVariance: items.filter((it) => (it.totalVarianceQty as number) < 0).length,
    // Phase 1 display-tier fields — count/backfill carried forward; dollar aggregates recomputed
    itemsPricedByInvoice: existingSummary.itemsPricedByInvoice ?? 0,
    displayTotalStockValue,
    displayTotalVarianceDollars,
    displayUnexplainedVarianceDollars,
    pricingBackfillAppliedAt: existingSummary.pricingBackfillAppliedAt ?? null,
  }
}

function normalise(name: string): string {
  return (name ?? '').toLowerCase().trim()
}

function findItemIndex(items: SnapshotItem[], rawName: string): number {
  const target = normalise(rawName)
  return items.findIndex(
    (it) => normalise(it._rawName ?? it.name) === target,
  )
}

// ---------------------------------------------------------------------------
// Preview (no writes)
// ---------------------------------------------------------------------------

export async function previewCorrection(
  venueId: string,
  departmentId: string,
  departmentName: string,
  cycleNumber: number,
  rawItemName: string,
  newActualClosing: number,
): Promise<CorrectionPreview> {
  const lines: PreviewLine[] = []

  // ── Cycle N ─────────────────────────────────────────────────────────────
  const snapN = await findSnapshotItem(venueId, departmentId, cycleNumber)
  if (snapN == null) throw new Error(`Snapshot cycle-${cycleNumber} not found.`)

  const idxN = findItemIndex(snapN.items, rawItemName)
  if (idxN === -1)
    throw new Error(`Item "${rawItemName}" not found in cycle ${cycleNumber}.`)

  const itemN = snapN.items[idxN]
  const beforeN = recalculateItem(itemN)
  const afterN = recalculateItem(itemN, { actualClosing: newActualClosing })

  lines.push({
    cycleNumber,
    departmentId,
    departmentName,
    itemName: rawItemName,
    before: beforeN,
    after: afterN,
  })

  // ── Cycle N+1 (downstream) ───────────────────────────────────────────────
  const snapN1 = await findSnapshotItem(venueId, departmentId, cycleNumber + 1)
  if (snapN1 != null) {
    const idxN1 = findItemIndex(snapN1.items, rawItemName)
    if (idxN1 !== -1) {
      const itemN1 = snapN1.items[idxN1]
      const beforeN1 = recalculateItem(itemN1)
      const afterN1 = recalculateItem(itemN1, { openingCount: newActualClosing })
      lines.push({
        cycleNumber: cycleNumber + 1,
        departmentId,
        departmentName,
        itemName: rawItemName,
        before: beforeN1,
        after: afterN1,
      })
    }
  }

  return { lines }
}

// ---------------------------------------------------------------------------
// Commit (atomic batch write)
// ---------------------------------------------------------------------------

export interface CommitCorrectionArgs {
  venueId: string
  departmentId: string
  departmentName: string
  cycleNumber: number
  rawItemName: string
  newActualClosing: number
  reason: string
  userId: string
  userEmail: string
}

export async function commitCorrection(args: CommitCorrectionArgs): Promise<string> {
  const {
    venueId, departmentId, departmentName, cycleNumber,
    rawItemName, newActualClosing, reason, userId, userEmail,
  } = args

  // Re-read both cycles fresh to guard against concurrent edits
  const snapN = await findSnapshotItem(venueId, departmentId, cycleNumber)
  if (snapN == null) throw new Error(`Snapshot cycle-${cycleNumber} not found.`)

  const idxN = findItemIndex(snapN.items, rawItemName)
  if (idxN === -1)
    throw new Error(`Item "${rawItemName}" not found in cycle ${cycleNumber}.`)

  const itemN = snapN.items[idxN]
  const oldActualClosing: number = itemN.actualClosing as number

  // Compute new figures for cycle N
  const afterN = recalculateItem(itemN, { actualClosing: newActualClosing })

  const updatedItemsN = [...snapN.items]
  updatedItemsN[idxN] = {
    ...itemN,
    actualClosing: newActualClosing,
    totalVarianceQty: afterN.totalVarianceQty,
    totalVarianceDollars: afterN.totalVarianceDollars,
    expectedClosing: afterN.expectedClosing,
    unexplainedVarianceQty: afterN.unexplainedVarianceQty,
    unexplainedVarianceDollars: afterN.unexplainedVarianceDollars,
    belowPAR: afterN.belowPAR,
    ranToZero: afterN.ranToZero,
    // Display-tier dollar figures recomputed against corrected qty; tier + displayCostPrice unchanged
    displayTotalVarianceDollars: afterN.displayTotalVarianceDollars,
    displayUnexplainedVarianceDollars: afterN.displayUnexplainedVarianceDollars,
  }

  const summaryN = computeSummary(updatedItemsN, snapN.summary)
  const batch = writeBatch(db)

  batch.update(snapN.snapshotRef, { items: updatedItemsN, summary: summaryN })

  // Check for downstream cycle and update its openingCount
  let downstreamUpdated = false
  const snapN1 = await findSnapshotItem(venueId, departmentId, cycleNumber + 1)
  if (snapN1 != null) {
    const idxN1 = findItemIndex(snapN1.items, rawItemName)
    if (idxN1 !== -1) {
      const itemN1 = snapN1.items[idxN1]
      const afterN1 = recalculateItem(itemN1, { openingCount: newActualClosing })

      const updatedItemsN1 = [...snapN1.items]
      updatedItemsN1[idxN1] = {
        ...itemN1,
        openingCount: newActualClosing,
        totalVarianceQty: afterN1.totalVarianceQty,
        totalVarianceDollars: afterN1.totalVarianceDollars,
        expectedClosing: afterN1.expectedClosing,
        unexplainedVarianceQty: afterN1.unexplainedVarianceQty,
        unexplainedVarianceDollars: afterN1.unexplainedVarianceDollars,
        belowPAR: afterN1.belowPAR,
        ranToZero: afterN1.ranToZero,
        displayTotalVarianceDollars: afterN1.displayTotalVarianceDollars,
        displayUnexplainedVarianceDollars: afterN1.displayUnexplainedVarianceDollars,
      }

      const summaryN1 = computeSummary(updatedItemsN1, snapN1.summary)
      batch.update(snapN1.snapshotRef, { items: updatedItemsN1, summary: summaryN1 })
      downstreamUpdated = true
    }
  }

  // Append-only audit trail
  const auditRef = doc(collection(db, 'venues', venueId, 'stocktakeCorrections'))
  batch.set(auditRef, {
    createdAt: serverTimestamp(),
    userId,
    userEmail,
    departmentId,
    departmentName,
    cycleNumber,
    itemName: rawItemName,
    oldActualClosing,
    newActualClosing,
    downstreamCycleUpdated: downstreamUpdated,
    reason,
  })

  // All three updates commit atomically — Firestore guarantees all-or-nothing
  await batch.commit()

  return auditRef.id
}
