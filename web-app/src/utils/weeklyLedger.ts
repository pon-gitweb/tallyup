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

export type VelocityStatus = 'Sold out' | 'No recent data' | 'Stagnant' | 'Slowing' | 'Selling'

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

export type VelocityWindowInfo = {
  anchorMonday: string
  last4CoveredDays: number
  prev4CoveredDays: number
  newestReportEnd: string | null
}

/**
 * Velocity row builder with calendar-anchored, coverage-normalised windows.
 *
 * Anchor = last complete calendar week (Mon-start) before the current NZ week.
 * last4 = 4 calendar weeks ending at the anchor.
 * prev4 = 4 calendar weeks before last4.
 * Coverage = distinct dates covered by at least one active, dated, matched report
 *            (union; no double-counting).  Reports with null matchesByReport are
 *            excluded (match run hasn't completed — F3).
 * changePct is rate-based (units/coveredDays); null when either window < 14 days.
 * Tue–Mon report Monday spill into the current week is excluded from units and coverage.
 */
export function buildVelocityRowsFromReports(
  reports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  stockMap: Record<string, StockEntry>,
  todayNZDate: string,
): { rows: VelocityRow[]; windowInfo: VelocityWindowInfo } {
  function addDays(s: string, n: number): string {
    return new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10)
  }

  const currentWeekMon = weekMonday(todayNZDate)
  const anchorMon = addDays(currentWeekMon, -7)

  const last4Mondays = [-21, -14, -7, 0].map(d => addDays(anchorMon, d))
  const prev4Mondays = [-49, -42, -35, -28].map(d => addDays(anchorMon, d))
  const last4Set = new Set(last4Mondays)
  const prev4Set = new Set(prev4Mondays)

  const last4WinStart = last4Mondays[0]
  const last4WinEnd   = addDays(anchorMon, 6)
  const prev4WinStart = prev4Mondays[0]
  const prev4WinEnd   = addDays(anchorMon, -22)

  // Active dated matched reports only (null = match run hasn't completed)
  const matchedReports = reports.filter(
    r => r.startStr && r.endStr && matchesByReport[r.id] != null
  )

  // Global covered days per window — union of distinct calendar dates
  const last4CovSet = new Set<string>()
  const prev4CovSet = new Set<string>()
  const currentWkStart = new Date(currentWeekMon + 'T00:00:00Z')

  for (const r of matchedReports) {
    let cur = new Date(r.startStr! + 'T00:00:00Z')
    const end = new Date(r.endStr! + 'T00:00:00Z')
    while (cur <= end && cur < currentWkStart) {
      const d = cur.toISOString().slice(0, 10)
      if (d >= last4WinStart && d <= last4WinEnd) last4CovSet.add(d)
      if (d >= prev4WinStart && d <= prev4WinEnd) prev4CovSet.add(d)
      cur = new Date(cur.getTime() + 86_400_000)
    }
  }

  const last4CoveredDays = last4CovSet.size
  const prev4CoveredDays = prev4CovSet.size

  const newestReportEnd = matchedReports.reduce<string | null>(
    (best, r) => r.endStr && (!best || r.endStr > best) ? r.endStr : best,
    null
  )

  // Per-product per-week unit accumulation (excludes current week days)
  const prodWeekUnits = new Map<string, { name: string; byWeek: Map<string, number> }>()

  for (const r of matchedReports) {
    const md = matchesByReport[r.id]!
    const wdMap = weekDayBreakdown(r.startStr!, r.endStr!)
    const totalDays = r.days ?? 1

    for (const m of md.matches) {
      const pid = m.productId
      if (!pid) continue
      const name = m.productName ?? m.name ?? pid
      const qty  = m.qtySold ?? 0

      if (!prodWeekUnits.has(pid)) prodWeekUnits.set(pid, { name, byWeek: new Map() })
      const e = prodWeekUnits.get(pid)!

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        if (wk >= currentWeekMon) continue  // ignore current-week spill
        e.byWeek.set(wk, (e.byWeek.get(wk) ?? 0) + qty * (daysInWk / totalDays))
      }
    }
  }

  const rows: VelocityRow[] = []

  for (const [pid, { name, byWeek }] of prodWeekUnits.entries()) {
    let last4Units = 0
    let prev4Units = 0
    for (const [wk, u] of byWeek.entries()) {
      if (last4Set.has(wk)) last4Units += u
      else if (prev4Set.has(wk)) prev4Units += u
    }

    // weeksSinceLastSale: calendar weeks between anchor and week of last sale
    let lastSaleWkMon: string | null = null
    for (const [wk, u] of byWeek.entries()) {
      if (u > 0 && (lastSaleWkMon === null || wk > lastSaleWkMon)) lastSaleWkMon = wk
    }
    let weeksSinceLastSale: number | null = null
    if (lastSaleWkMon !== null) {
      const diff = new Date(anchorMon + 'T00:00:00Z').getTime() -
                   new Date(lastSaleWkMon + 'T00:00:00Z').getTime()
      weeksSinceLastSale = Math.max(0, Math.round(diff / (7 * 86_400_000)))
    }

    const latestStock = stockMap[pid]?.count ?? null

    // Rate-based changePct; null if either window < 14 covered days or prev rate = 0
    let changePct: number | null = null
    if (last4CoveredDays >= 14 && prev4CoveredDays >= 14 && prev4Units > 0) {
      changePct = ((last4Units / last4CoveredDays) / (prev4Units / prev4CoveredDays) - 1) * 100
    }

    const hasSales = [...byWeek.values()].some(u => u > 0)

    let status: VelocityStatus = 'Selling'
    if (latestStock === 0) {
      status = 'Sold out'
    } else if (last4CoveredDays < 14) {
      status = 'No recent data'
    } else if (last4Units === 0 && hasSales) {
      status = 'Stagnant'
    } else if (
      prev4Units >= 8 &&
      prev4CoveredDays >= 14 &&
      (last4Units / last4CoveredDays) < (prev4Units / prev4CoveredDays) * 0.75
    ) {
      status = 'Slowing'
    }

    rows.push({ productId: pid, name, last4Units, prev4Units, changePct, weeksSinceLastSale, latestStock, status })
  }

  return { rows, windowInfo: { anchorMonday: anchorMon, last4CoveredDays, prev4CoveredDays, newestReportEnd } }
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
    if (md == null) continue  // match run not completed — excluded per F3
    const matchedNames = new Set(
      md.matches.map(m => normName(m.name ?? m.productName))
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
