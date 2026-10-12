/**
 * Pure functions for the weekly-ledger view.
 *
 * Extracted from scripts/admin/preview-weekly-ledger.js (origin/feat/weekly-ledger-preview).
 * All date handling is in Pacific/Auckland; calendar weeks are Monday-start.
 * Uses isReportActive() instead of checking status === 'superseded' so voided
 * reports are also excluded from analytics.
 */

import { isReportActive } from './isReportActive'

export const NZ_TZ = 'Pacific/Auckland'

// ── Date helpers ──────────────────────────────────────────────────────────────

export function toNZDate(ts: { toDate(): Date } | Date | null | undefined): string | null {
  if (!ts) return null
  const d = (ts as any).toDate ? (ts as any).toDate() : new Date(ts as any)
  return d.toLocaleDateString('en-CA', { timeZone: NZ_TZ }) // en-CA → YYYY-MM-DD
}

export function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = d.getUTCDay()
  const delta = dow === 0 ? 6 : dow - 1
  return new Date(d.getTime() - delta * 86_400_000).toISOString().slice(0, 10)
}

export function daySpan(startStr: string, endStr: string): number {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z').getTime() - new Date(startStr + 'T00:00:00Z').getTime()) / 86_400_000
  ) + 1
}

/** Map of { weekMondayStr → dayCount } for every calendar week a period touches. */
export function weekDayBreakdown(startStr: string, endStr: string): Record<string, number> {
  const map: Record<string, number> = {}
  let cur = new Date(startStr + 'T00:00:00Z')
  const end = new Date(endStr + 'T00:00:00Z')
  while (cur <= end) {
    const wk = weekMonday(cur.toISOString().slice(0, 10))
    map[wk] = (map[wk] ?? 0) + 1
    cur = new Date(cur.getTime() + 86_400_000)
  }
  return map
}

// ── Report types ──────────────────────────────────────────────────────────────

export type RawSalesLine = {
  name?: string | null
  qtySold?: number | null
  gross?: number | null
  net?: number | null
  category?: string | null
  grossIncl?: number | null
  netExcl?: number | null
}

export type MatchEntry = {
  productId?: string | null
  productName?: string | null
  name?: string | null
  qtySold?: number | null
  gross?: number | null
}

export type MatchData = {
  matched: number
  total: number
  matchedRevenue: number
  matchedQty: number
  matches: MatchEntry[]
}

export type ActiveReport = {
  id: string
  source: string
  startStr: string | null
  endStr: string | null
  startMs: number | null
  days: number | null
  lineCount: number
  totalRevenue: number
  totalQtySold: number
  rawLines: RawSalesLine[]
  overlappingCycles: unknown[]
  allocationMethod: string
  status: string | null
  meta?: {
    sourceFormat?: string | null
    parserVersion?: number | null
    lineTotalsBasis?: string | null
    gstBasis?: string | null
    kind?: string | null
    reportTotals?: unknown | null
    categoryTotals?: unknown[] | null
    fileHash?: string | null
  } | null
}

// ── Partition ─────────────────────────────────────────────────────────────────

export type PartitionResult = {
  reports: ActiveReport[]
  prePeriod: ActiveReport[]
  inactiveCount: number
}

export function partitionReports(
  allDocs: Array<{ id: string; data(): Record<string, any> }>
): PartitionResult {
  let inactiveCount = 0
  const activeDocs: typeof allDocs = []

  for (const docSnap of allDocs) {
    const d = docSnap.data()
    if (!isReportActive(d)) { inactiveCount++; continue }
    activeDocs.push(docSnap)
  }

  const mapped: ActiveReport[] = activeDocs.map(docSnap => {
    const d = docSnap.data()
    const rawLines: RawSalesLine[] = d.report?.lines ?? d.lines ?? []
    const totalRevenue  = rawLines.reduce((s, l) => s + (l.grossIncl ?? l.gross ?? 0), 0)
    const totalQtySold  = rawLines.reduce((s, l) => s + (l.qtySold ?? 0), 0)
    const startStr = d.report?.period?.start ?? toNZDate(d.periodStart)
    const endStr   = d.report?.period?.end   ?? toNZDate(d.periodEnd)
    const startMs  = d.periodStart?.toMillis?.() ??
                     (startStr ? new Date(startStr + 'T00:00:00Z').getTime() : null)
    return {
      id: docSnap.id,
      source: d.source ?? '?',
      startStr, endStr, startMs,
      days: startStr && endStr ? daySpan(startStr, endStr) : null,
      lineCount: rawLines.length,
      totalRevenue,
      totalQtySold,
      rawLines,
      overlappingCycles: d.overlappingCycles ?? [],
      allocationMethod:  d.allocationMethod  ?? 'none',
      status: d.status ?? null,
      meta: d.report?.meta ?? null,
    }
  })

  mapped.sort((a, b) => {
    if (a.startMs == null && b.startMs == null) return 0
    if (a.startMs == null) return 1
    if (b.startMs == null) return -1
    return a.startMs - b.startMs
  })

  return {
    reports:      mapped.filter(r => !r.startStr == false && r.startStr != null),
    prePeriod:    mapped.filter(r => r.startStr == null),
    inactiveCount,
  }
}

// ── Weekly aggregation ────────────────────────────────────────────────────────

export type WeekEntry = { units: number; revenue: number }
export type ProductEntry = {
  name: string
  totalUnits: number
  totalRevenue: number
  reportWeeks: Set<string>
}

export type WeeklyAggregation = {
  weekMap:   Map<string, WeekEntry>
  productMap: Map<string, ProductEntry>
  sortedWeeks: string[]
}

export function buildWeeklyAggregation(
  reports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
): WeeklyAggregation {
  const weekMap   = new Map<string, WeekEntry>()
  const productMap = new Map<string, ProductEntry>()

  for (const r of reports) {
    const md = matchesByReport[r.id]
    if (!r.startStr || !r.endStr) continue

    const totalDays = r.days ?? 1
    const wdMap = weekDayBreakdown(r.startStr, r.endStr)

    if (!md) continue

    for (const m of md.matches) {
      const pid   = m.productId
      if (!pid) continue
      const name  = m.productName ?? m.name ?? pid
      const qty   = m.qtySold ?? 0
      const gross = m.gross   ?? 0

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        const frac = daysInWk / totalDays

        if (!weekMap.has(wk)) weekMap.set(wk, { units: 0, revenue: 0 })
        const wkE = weekMap.get(wk)!
        wkE.units   += qty   * frac
        wkE.revenue += gross * frac

        if (!productMap.has(pid)) {
          productMap.set(pid, { name, totalUnits: 0, totalRevenue: 0, reportWeeks: new Set() })
        }
        const pE = productMap.get(pid)!
        pE.totalUnits   += qty   * frac
        pE.totalRevenue += gross * frac
        pE.reportWeeks.add(wk)
      }
    }
  }

  const sortedWeeks = [...weekMap.keys()].sort()
  return { weekMap, productMap, sortedWeeks }
}

// ── Stock map ─────────────────────────────────────────────────────────────────

export type StockEntry = { count: number; cycleNumber: number }

export function buildStockMap(
  snapshots: Array<{
    cycleNumber: number
    items: Array<{ productId?: string | null; actualClosing?: number | null }>
  }>
): Record<string, StockEntry> {
  const stockMap: Record<string, StockEntry> = {}
  for (const s of snapshots) {
    for (const item of s.items) {
      if (!item.productId) continue
      const existing = stockMap[item.productId]
      if (item.actualClosing != null &&
          (!existing || s.cycleNumber > existing.cycleNumber)) {
        stockMap[item.productId] = { count: item.actualClosing, cycleNumber: s.cycleNumber }
      }
    }
  }
  return stockMap
}

// ── Velocity status ───────────────────────────────────────────────────────────

export type VelocityStatus = 'Sold out' | 'Stagnant' | 'Slowing' | 'Selling'

export type VelocityRow = {
  productId: string
  name: string
  last4Units: number
  prev4Units: number
  changePct: number | null
  weeksSinceLastSale: number | null
  latestStock: number | null
  status: VelocityStatus
}


/**
 * Full velocity row builder that tracks per-product per-week units directly.
 * This is the accurate version used in SalesReportsPage.
 */
export function buildVelocityRowsFromReports(
  reports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  stockMap: Record<string, StockEntry>,
  todayNZDate: string,
): VelocityRow[] {
  const currentWeekMon = weekMonday(todayNZDate)

  // First pass: collect all weeks
  const allWeekSet = new Set<string>()
  for (const r of reports) {
    if (!r.startStr || !r.endStr) continue
    for (const wk of Object.keys(weekDayBreakdown(r.startStr, r.endStr))) {
      allWeekSet.add(wk)
    }
  }
  const sortedWeeks = [...allWeekSet].sort().filter(w => w < currentWeekMon)
  const last4 = sortedWeeks.slice(-4)
  const prev4 = sortedWeeks.slice(-8, -4)
  const last4Set = new Set(last4)
  const prev4Set = new Set(prev4)

  // Per-product per-week unit accumulator
  const prodWeekUnits = new Map<string, { name: string; byWeek: Map<string, number> }>()

  for (const r of reports) {
    const md = matchesByReport[r.id]
    if (!r.startStr || !r.endStr || !md) continue
    const totalDays = r.days ?? 1
    const wdMap = weekDayBreakdown(r.startStr, r.endStr)

    for (const m of md.matches) {
      const pid = m.productId
      if (!pid) continue
      const name = m.productName ?? m.name ?? pid
      const qty  = m.qtySold ?? 0

      if (!prodWeekUnits.has(pid)) prodWeekUnits.set(pid, { name, byWeek: new Map() })
      const e = prodWeekUnits.get(pid)!

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        const prev = e.byWeek.get(wk) ?? 0
        e.byWeek.set(wk, prev + qty * (daysInWk / totalDays))
      }
    }
  }

  const rows: VelocityRow[] = []

  for (const [pid, { name, byWeek }] of prodWeekUnits.entries()) {
    let last4Units = 0
    let prev4Units = 0
    let lastSaleWeekIdx = -1

    for (let i = 0; i < sortedWeeks.length; i++) {
      const wk = sortedWeeks[i]
      const u = byWeek.get(wk) ?? 0
      if (last4Set.has(wk)) { last4Units += u; if (u > 0) lastSaleWeekIdx = i }
      else if (prev4Set.has(wk)) { prev4Units += u }
    }

    const latestStock = stockMap[pid]?.count ?? null
    const changePct = prev4Units > 0
      ? ((last4Units - prev4Units) / prev4Units) * 100
      : null

    let weeksSinceLastSale: number | null = null
    if (lastSaleWeekIdx < 0) {
      // Not seen in last 4 weeks — find last sale across all weeks
      for (let i = sortedWeeks.length - 1; i >= 0; i--) {
        if ((byWeek.get(sortedWeeks[i]) ?? 0) > 0) {
          weeksSinceLastSale = sortedWeeks.length - 1 - i
          break
        }
      }
    } else {
      weeksSinceLastSale = sortedWeeks.length - 1 - lastSaleWeekIdx
    }

    const hasSales = [...byWeek.values()].some(u => u > 0)

    let status: VelocityStatus = 'Selling'
    if (latestStock === 0) {
      status = 'Sold out'
    } else if (last4Units === 0 && hasSales) {
      status = 'Stagnant'
    } else if (prev4Units >= 8 && last4Units < prev4Units * 0.75) {
      status = 'Slowing'
    }

    rows.push({ productId: pid, name, last4Units, prev4Units, changePct, weeksSinceLastSale, latestStock, status })
  }

  return rows
}

// ── Normalised line name ──────────────────────────────────────────────────────

export function normName(n: string | null | undefined): string {
  return (n ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// ── Unmatched grouping ────────────────────────────────────────────────────────

export type UnmatchedRow = {
  normalisedName: string
  origName: string
  totalQty: number
  totalRevenue: number
  reportCount: number
}

export function buildUnmatchedRows(
  reports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
): UnmatchedRow[] {
  const byName = new Map<string, UnmatchedRow>()

  for (const r of reports) {
    const md = matchesByReport[r.id]
    const matchedNames = new Set(
      (md?.matches ?? []).map(m => normName(m.name ?? m.productName))
    )
    const hasLineTotals = r.meta?.lineTotalsBasis === 'line_total'

    for (const line of r.rawLines) {
      const nn = normName(line.name)
      if (!nn || matchedNames.has(nn)) continue

      if (!byName.has(nn)) {
        byName.set(nn, { normalisedName: nn, origName: line.name ?? nn, totalQty: 0, totalRevenue: 0, reportCount: 0 })
      }
      const u = byName.get(nn)!
      u.totalQty += line.qtySold ?? 0
      u.totalRevenue += hasLineTotals ? (line.grossIncl ?? line.gross ?? 0) : 0
      u.reportCount++
    }
  }

  return [...byName.values()].sort((a, b) => b.totalQty - a.totalQty)
}
