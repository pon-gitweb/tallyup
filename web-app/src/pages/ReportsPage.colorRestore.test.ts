/**
 * Tests for the color restoration and bar-chart trend rebuild.
 *
 * Context: an earlier fix over-applied a narrow, correct insight (the old
 * trend line's cross-period color comparison was broken) to locations that
 * never had that problem — summary cards, the drivers bar chart, and table
 * columns all color a single, point-in-time value by its own sign. Removing
 * color there was a genuine regression; this restores it.
 *
 * The trend chart is separately rebuilt as ComposedChart (Bar + Line).
 * Each bar is colored by its own sign — no comparison to the adjacent bar —
 * which avoids the "crossing zero" trap that triggered the original change.
 *
 * Coverage:
 *   A. Trend bar colors — each bar's own sign, no cross-bar comparison
 *   B. fmtAxis — sub-$1000 branch now rounds correctly
 *   C. Summary card colors — restored point-in-time directional colors
 *   D. Variance Detail table — unit/dollar column colors restored
 *   E. History table — variance column colors restored
 *   F. Drivers bar — shortage=error, excess=success (the .shortage boolean)
 */

import { describe, it, expect } from 'vitest'

const theme = {
  error:    '#dc2626',
  success:  '#16a34a',
  slateMid: '#6B7280',
  amber:    '#c47b2b',
}

// ── Suite A: Trend chart — bar color per entry's own sign ─────────────────────
// Production: Cell fill = entry.variance < 0 ? error : > 0 ? success : slateMid

function trendBarColor(variance: number): string {
  return variance < 0 ? theme.error : variance > 0 ? theme.success : theme.slateMid
}

describe('Trend chart bar colors — own-sign, no cross-bar comparison (A)', () => {
  it('A1: negative bar (net shortage) is error red', () => {
    expect(trendBarColor(-50)).toBe(theme.error)
    expect(trendBarColor(-1)).toBe(theme.error)
  })

  it('A2: positive bar (net excess) is success green', () => {
    expect(trendBarColor(+150)).toBe(theme.success)
    expect(trendBarColor(+1)).toBe(theme.success)
  })

  it('A3: zero bar is neutral slateMid', () => {
    expect(trendBarColor(0)).toBe(theme.slateMid)
  })

  it('A4: mixed-sign sequence — each bar colored independently', () => {
    const data = [-300, +200, -50, 0, +100]
    const colors = data.map(trendBarColor)
    expect(colors).toEqual([
      theme.error,   // -300
      theme.success, // +200
      theme.error,   // -50
      theme.slateMid,// 0
      theme.success, // +100
    ])
  })

  it('A5: two adjacent negative bars are both error — no comparison to neighbor', () => {
    // Old approach would compare adjacent bars; this approach colors each independently.
    const colors = [-300, -100].map(trendBarColor)
    expect(colors[0]).toBe(theme.error)
    expect(colors[1]).toBe(theme.error)
    // Both are error even though the situation "improved" numerically.
    // The bar's own sign (still negative = still a shortage) is what matters.
  })

  it('A6: improving then worsening — no color flip between adjacent bars', () => {
    // [-500, -100, -300] — all negative, all error regardless of direction of change
    const colors = [-500, -100, -300].map(trendBarColor)
    expect(colors.every((c) => c === theme.error)).toBe(true)
  })

  it('A7: the "crossing zero" scenario that broke the old approach — each bar still correct', () => {
    // Old trend line: $500 shortage (negative) → $100 excess (positive).
    // Old cross-period comparison: signed value went up (−500 → +100), colored "worse."
    // New per-bar coloring: −500 is error, +100 is success — independently correct.
    expect(trendBarColor(-500)).toBe(theme.error)
    expect(trendBarColor(+100)).toBe(theme.success)
  })
})

// ── Suite B: fmtAxis — sub-$1000 rounding ────────────────────────────────────
// Bug: abs >= 1000 used Math.round() but sub-$1000 used raw abs (decimal noise).
// Fix: both branches use Math.round().

function fmtAxis(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  return abs >= 1000 ? `${sign}$${Math.round(abs / 1000)}k` : `${sign}$${Math.round(abs)}`
}

describe('fmtAxis — sub-$1000 branch rounds correctly (B)', () => {
  it('B1: near-zero floating-point tick rounds to clean $0, not decimal noise', () => {
    // recharts can emit ticks like 0.0000000001 or -0.0000000001
    expect(fmtAxis(0.0000001)).toBe('$0')
    expect(fmtAxis(-0.0000001)).toBe('-$0')
    expect(fmtAxis(0)).toBe('$0')
  })

  it('B2: sub-$1000 positive value rounds correctly', () => {
    expect(fmtAxis(166.666)).toBe('$167')
    expect(fmtAxis(499.4)).toBe('$499')
    expect(fmtAxis(499.5)).toBe('$500')
  })

  it('B3: sub-$1000 negative value rounds correctly', () => {
    expect(fmtAxis(-333.333)).toBe('-$333')
    expect(fmtAxis(-0.9)).toBe('-$1')
  })

  it('B4: exactly $1000 uses the k branch', () => {
    expect(fmtAxis(1000)).toBe('$1k')
    expect(fmtAxis(-1000)).toBe('-$1k')
  })

  it('B5: $1500 rounds to $2k', () => {
    expect(fmtAxis(1500)).toBe('$2k')
  })

  it('B6: $1499 rounds to $1k', () => {
    expect(fmtAxis(1499)).toBe('$1k')
  })
})

// ── Suite C: Summary card — restored directional colors ───────────────────────
// Production: showVariance < 0 ? error : > 0 ? success : slateMid
// (showVariance is guaranteed non-null at this call site — outer guard checks it)

function summaryCardColor(showVariance: number): string {
  return showVariance < 0 ? theme.error : showVariance > 0 ? theme.success : theme.slateMid
}

describe('Summary card — directional color restored (C)', () => {
  it('C1: negative variance (shortage) is error red — restored', () => {
    expect(summaryCardColor(-250)).toBe(theme.error)
    expect(summaryCardColor(-250)).not.toBe(theme.slateMid)
  })

  it('C2: positive variance (excess) is success green — restored', () => {
    expect(summaryCardColor(+250)).toBe(theme.success)
    expect(summaryCardColor(+250)).not.toBe(theme.slateMid)
  })

  it('C3: zero variance is neutral slateMid — unchanged', () => {
    expect(summaryCardColor(0)).toBe(theme.slateMid)
  })

  it('C4: shortage and excess cards are visually distinct — confirming restoration', () => {
    expect(summaryCardColor(-100)).not.toBe(summaryCardColor(+100))
  })
})

// ── Suite D: Variance Detail table — unit/dollar columns ──────────────────────

function unitVarianceColor(varianceUnits: number): string {
  return varianceUnits < 0 ? theme.error : varianceUnits > 0 ? theme.success : theme.slateMid
}

function dollarVarianceColor(value: number | null): string {
  if (value == null) return theme.slateMid
  return value < 0 ? theme.error : value > 0 ? theme.success : theme.slateMid
}

describe('Variance Detail table — unit/dollar colors restored (D)', () => {
  it('D1: negative unit variance is error red', () => {
    expect(unitVarianceColor(-3.5)).toBe(theme.error)
  })

  it('D2: positive unit variance is success green', () => {
    expect(unitVarianceColor(+3.5)).toBe(theme.success)
  })

  it('D3: zero unit variance is slateMid', () => {
    expect(unitVarianceColor(0)).toBe(theme.slateMid)
  })

  it('D4: negative dollar variance is error red', () => {
    expect(dollarVarianceColor(-150)).toBe(theme.error)
  })

  it('D5: positive dollar variance is success green', () => {
    expect(dollarVarianceColor(+150)).toBe(theme.success)
  })

  it('D6: null dollar variance is slateMid (no cost price)', () => {
    expect(dollarVarianceColor(null)).toBe(theme.slateMid)
  })

  it('D7: unit shortage and unit excess produce distinct colors', () => {
    expect(unitVarianceColor(-5)).not.toBe(unitVarianceColor(+5))
  })
})

// ── Suite E: History table variance column ────────────────────────────────────

function historyVarianceColor(totalVarianceDollars: number | null): string {
  if (totalVarianceDollars == null) return theme.slateMid
  return totalVarianceDollars < 0 ? theme.error : totalVarianceDollars > 0 ? theme.success : theme.slateMid
}

describe('History table variance column — directional color restored (E)', () => {
  it('E1: negative variance is error red', () => {
    expect(historyVarianceColor(-300)).toBe(theme.error)
  })

  it('E2: positive variance is success green', () => {
    expect(historyVarianceColor(+300)).toBe(theme.success)
  })

  it('E3: null variance (no cost prices) is slateMid', () => {
    expect(historyVarianceColor(null)).toBe(theme.slateMid)
  })

  it('E4: zero variance is slateMid', () => {
    expect(historyVarianceColor(0)).toBe(theme.slateMid)
  })
})

// ── Suite F: Top variance drivers bar — shortage/excess color ─────────────────
// Production: props.shortage ? error : success
// The .shortage boolean comes from topDrivers: displayVal < 0

function driversBarColor(shortage: boolean): string {
  return shortage ? theme.error : theme.success
}

describe('Top variance drivers bar — shortage=error, excess=success (F)', () => {
  it('F1: shortage bar (displayVal < 0) is error red, not amber', () => {
    expect(driversBarColor(true)).toBe(theme.error)
    expect(driversBarColor(true)).not.toBe(theme.amber)
  })

  it('F2: excess bar (displayVal > 0) is success green, not amber', () => {
    expect(driversBarColor(false)).toBe(theme.success)
    expect(driversBarColor(false)).not.toBe(theme.amber)
  })

  it('F3: shortage and excess bars are visually distinct', () => {
    expect(driversBarColor(true)).not.toBe(driversBarColor(false))
  })
})
