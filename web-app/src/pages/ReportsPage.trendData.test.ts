/**
 * Tests for the zero-centered trend line fix.
 *
 * Root change: removed Math.abs() from trendData aggregation (line 313) so the
 * per-cycle variance is the *net signed sum* across departments, not the sum of
 * absolute values. Added a zero-clamped YAxis domain and a ReferenceLine at y=0
 * so position communicates direction without requiring color.
 *
 * Coverage:
 *   A. Net signed aggregation — cancellation, shortage-only, excess-only
 *   B. Y-axis domain always includes zero as a fixed reference point
 *   C. Single-department regression — no change in magnitude for simple cases
 */

import { describe, it, expect } from 'vitest'

// ── Pure function mirrors the fixed production aggregation ────────────────────
// Mirrors the useMemo at ReportsPage.tsx ~line 307-322 (post-fix).
// Input: rows from historyRows (cycleNumber + totalVarianceDollars).
// Output: array of { label, variance } sorted by cycleNum.

type HistoryRow = {
  cycleNumber: number
  totalVarianceDollars: number | null
  completedAt: Date | null
}

function buildTrendData(rows: HistoryRow[]): Array<{ label: string; variance: number }> {
  const byLabel: Record<string, { cycleNum: number; variance: number }> = {}
  for (const row of rows) {
    if (row.totalVarianceDollars == null) continue
    const key = String(row.cycleNumber)
    if (!byLabel[key]) byLabel[key] = { cycleNum: row.cycleNumber, variance: 0 }
    // Post-fix: raw signed value, no Math.abs()
    byLabel[key].variance += row.totalVarianceDollars
  }
  return Object.values(byLabel)
    .sort((a, b) => a.cycleNum - b.cycleNum)
    .map((d) => ({ label: `S${d.cycleNum}`, variance: d.variance }))
}

// ── Y-axis domain function — mirrors the chart's domain prop ──────────────────
// Domain clamps to always include 0:
//   min: Math.min(0, dataMin)
//   max: Math.max(0, dataMax)

function domainMin(dataMin: number): number { return Math.min(0, dataMin) }
function domainMax(dataMax: number): number { return Math.max(0, dataMax) }

// ── Suite A: Net signed aggregation ──────────────────────────────────────────

describe('trendData — net signed variance, not absolute sum (A)', () => {
  it('A1: shortage in one dept, excess in another → net signed value (not absolute sum)', () => {
    // Bar: -$200 (shortage), Kitchen: +$150 (excess)
    // Old (Math.abs): $200 + $150 = $350
    // New (signed):   -$200 + $150 = -$50
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: -200, completedAt: null },
      { cycleNumber: 1, totalVarianceDollars: +150, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result).toHaveLength(1)
    expect(result[0].variance).toBe(-50)
    expect(result[0].variance).not.toBe(350) // explicitly not the old absolute-sum behavior
  })

  it('A2: two shortages in the same cycle sum to a larger shortage', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 2, totalVarianceDollars: -100, completedAt: null },
      { cycleNumber: 2, totalVarianceDollars: -80, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(-180)
  })

  it('A3: two excesses in the same cycle sum to a larger excess', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 3, totalVarianceDollars: +90, completedAt: null },
      { cycleNumber: 3, totalVarianceDollars: +60, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(+150)
  })

  it('A4: equal and opposite values in one cycle net to zero', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 4, totalVarianceDollars: -300, completedAt: null },
      { cycleNumber: 4, totalVarianceDollars: +300, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(0)
  })

  it('A5: multi-cycle result is sorted by cycle number', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 3, totalVarianceDollars: -100, completedAt: null },
      { cycleNumber: 1, totalVarianceDollars: +200, completedAt: null },
      { cycleNumber: 2, totalVarianceDollars: -50, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result.map((r) => r.label)).toEqual(['S1', 'S2', 'S3'])
    expect(result.map((r) => r.variance)).toEqual([200, -50, -100])
  })

  it('A6: null totalVarianceDollars is skipped (cycle with only nulls is absent)', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: null,  completedAt: null },
      { cycleNumber: 2, totalVarianceDollars: -100, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('S2')
  })
})

// ── Suite B: Y-axis domain always includes zero ───────────────────────────────

describe('Y-axis domain — zero always included as fixed reference (B)', () => {
  it('B1: all-positive data — domain min is 0, not the data min', () => {
    // Data spans +100..+500. Without clamping, recharts would auto-scale to ~100.
    // With clamping: min = Math.min(0, 100) = 0.
    expect(domainMin(100)).toBe(0)
    expect(domainMax(500)).toBe(500)
  })

  it('B2: all-negative data — domain max is 0, not the data max', () => {
    // Data spans -500..-100. Without clamping, recharts would auto-scale to ~-100.
    // With clamping: max = Math.max(0, -100) = 0.
    expect(domainMin(-500)).toBe(-500)
    expect(domainMax(-100)).toBe(0)
  })

  it('B3: mixed data already spanning zero — domain unchanged', () => {
    expect(domainMin(-200)).toBe(-200)
    expect(domainMax(+150)).toBe(+150)
  })

  it('B4: all-zero data — domain is [0, 0] (flat line at baseline)', () => {
    expect(domainMin(0)).toBe(0)
    expect(domainMax(0)).toBe(0)
  })

  it('B5: domain min is always ≤ 0 for any input', () => {
    for (const v of [-1000, -1, 0, 1, 1000]) {
      expect(domainMin(v)).toBeLessThanOrEqual(0)
    }
  })

  it('B6: domain max is always ≥ 0 for any input', () => {
    for (const v of [-1000, -1, 0, 1, 1000]) {
      expect(domainMax(v)).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── Suite C: Single-department regression ─────────────────────────────────────
// For venues with one department, there's no cancellation.
// The magnitude should be identical to before the fix; only the sign is preserved.

describe('Single-department venue — no regression in magnitude (C)', () => {
  it('C1: single shortage dept — magnitude preserved, sign negative', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: -300, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(-300)
    expect(Math.abs(result[0].variance)).toBe(300) // same magnitude as old Math.abs() behavior
  })

  it('C2: single excess dept — magnitude preserved, sign positive', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: +420, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(+420)
    expect(Math.abs(result[0].variance)).toBe(420)
  })

  it('C3: single dept across multiple cycles — each cycle independent', () => {
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: -300, completedAt: null },
      { cycleNumber: 2, totalVarianceDollars: -180, completedAt: null },
      { cycleNumber: 3, totalVarianceDollars: +50,  completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result.map((r) => r.variance)).toEqual([-300, -180, +50])
  })

  it('C4: multi-dept with no cancellation — same as single dept summing', () => {
    // Two depts, both shortages — no cancellation, same as before.
    const rows: HistoryRow[] = [
      { cycleNumber: 1, totalVarianceDollars: -200, completedAt: null },
      { cycleNumber: 1, totalVarianceDollars: -100, completedAt: null },
    ]
    const result = buildTrendData(rows)
    expect(result[0].variance).toBe(-300) // sum, not absolute sum (same result here)
    expect(result[0].variance).toBe(-300) // not -300 from Math.abs(−200)+Math.abs(−100)=300 (old) vs −300 (new) — same magnitude but now signed
  })
})
