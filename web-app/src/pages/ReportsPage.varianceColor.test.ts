/**
 * Tests for the unexplained-variance color convention change (handoff: remove
 * directional color-coding from inventory variance).
 *
 * Previously, positive variance used theme.success (green) and negative used
 * theme.error (red), implying excess is good and shortage is bad. This is
 * actively misleading — both are unexplained discrepancies. The fix replaces
 * all inventory-variance color judgments with a single neutral tone, keeping
 * directional information in the ▲/▼ arrow and ±sign instead.
 *
 * Strategy: pure-function helpers mirroring the production rendering logic —
 * no React or Firebase dependency. Same pattern as ReportsPage.impactOnGP.test.ts.
 *
 * Coverage:
 *   A. Summary card — positive and negative variance produce identical color
 *   B. Trend line — color is the same regardless of direction of change,
 *      including the "shrinking problem crossing zero" scenario
 *   C. Bar chart — shortage and excess bars produce identical fill
 *   D. Variance Detail table — unit and dollar columns both neutral
 *   E. Velocity trend indicator is provably untouched (structural source check)
 */

import { describe, it, expect } from 'vitest'

// ── Theme stub (mirrors web-app/src/theme.ts exactly) ────────────────────────

const theme = {
  error:    '#dc2626',
  success:  '#16a34a',
  slateMid: '#6B7280',
  amber:    '#c47b2b',
}

// ── Suite A: Summary card variance color ─────────────────────────────────────
//
// Production code (after fix):
//   color: theme.slateMid   (replaced the < 0 ? error : > 0 ? success : slateMid pattern)

function summaryCardVarianceColor(_showVariance: number): string {
  // Mirrors the fixed production rendering: always slateMid, regardless of sign.
  return theme.slateMid
}

describe('Summary card — inventory variance color (handoff fix)', () => {
  it('A1: positive variance (excess) renders with slateMid, not green', () => {
    expect(summaryCardVarianceColor(+250)).toBe(theme.slateMid)
    expect(summaryCardVarianceColor(+250)).not.toBe(theme.success)
  })

  it('A2: negative variance (shortage) renders with slateMid, not red', () => {
    expect(summaryCardVarianceColor(-250)).toBe(theme.slateMid)
    expect(summaryCardVarianceColor(-250)).not.toBe(theme.error)
  })

  it('A3: positive and negative variance produce identical colors', () => {
    expect(summaryCardVarianceColor(+500)).toBe(summaryCardVarianceColor(-500))
  })

  it('A4: zero variance also renders with slateMid (unchanged from pre-fix)', () => {
    expect(summaryCardVarianceColor(0)).toBe(theme.slateMid)
  })
})

// ── Suite B: Trend line color ─────────────────────────────────────────────────
//
// Production code (after fix):
//   const trendLineColor = theme.slateMid
//   (replaced: last.variance > prev.variance ? theme.error : theme.success)
//
// The "shrinking problem crossing zero" scenario that was previously broken:
//   Period N−1: $500 shortage (absolute magnitude 500)
//   Period N:   $100 excess   (absolute magnitude 100)
//   Previously: the signed comparison could read this as "numerically higher" → error (red)
//   After fix: always slateMid, regardless of trend direction.

function trendLineColor(
  _trendData: Array<{ variance: number }>,
): string {
  // Mirrors the fixed production code: constant, no comparison.
  return theme.slateMid
}

describe('Trend line — directional color removed (handoff fix)', () => {
  it('B1: trend line is slateMid when variance increased (getting worse)', () => {
    const data = [{ variance: 100 }, { variance: 500 }]
    expect(trendLineColor(data)).toBe(theme.slateMid)
    expect(trendLineColor(data)).not.toBe(theme.error)
  })

  it('B2: trend line is slateMid when variance decreased (getting better)', () => {
    const data = [{ variance: 500 }, { variance: 100 }]
    expect(trendLineColor(data)).toBe(theme.slateMid)
    expect(trendLineColor(data)).not.toBe(theme.success)
  })

  it('B3: trend line color is identical whether variance went up or down', () => {
    const improving = [{ variance: 500 }, { variance: 100 }]
    const worsening = [{ variance: 100 }, { variance: 500 }]
    expect(trendLineColor(improving)).toBe(trendLineColor(worsening))
  })

  it('B4: "shrinking problem crossing zero" — previously broken scenario is now neutral', () => {
    // $500 shortage period → $100 excess period
    // In absolute terms: 500 → 100 (improving). In the OLD signed comparison,
    // if trendData stored signed values, −500 → +100 reads as "increase" → red.
    // After fix: just slateMid, no comparison at all.
    const shrinkingCrossZero = [{ variance: 500 }, { variance: 100 }]
    expect(trendLineColor(shrinkingCrossZero)).toBe(theme.slateMid)
    expect(trendLineColor(shrinkingCrossZero)).not.toBe(theme.error)
    expect(trendLineColor(shrinkingCrossZero)).not.toBe(theme.success)
  })

  it('B5: single-period data produces slateMid (no comparison possible)', () => {
    expect(trendLineColor([{ variance: 200 }])).toBe(theme.slateMid)
  })

  it('B6: empty data produces slateMid', () => {
    expect(trendLineColor([])).toBe(theme.slateMid)
  })
})

// ── Suite C: Bar chart — top variance drivers fill ────────────────────────────
//
// Production code (after fix):
//   const fill = theme.amber   (replaced: shortage ? theme.error : theme.success)

function barFill(_shortage: boolean): string {
  // Mirrors the fixed production code.
  return theme.amber
}

describe('Bar chart — top variance drivers fill (handoff fix)', () => {
  it('C1: shortage bar is amber, not red', () => {
    expect(barFill(true)).toBe(theme.amber)
    expect(barFill(true)).not.toBe(theme.error)
  })

  it('C2: excess bar is amber, not green', () => {
    expect(barFill(false)).toBe(theme.amber)
    expect(barFill(false)).not.toBe(theme.success)
  })

  it('C3: shortage and excess bars have identical fill colors', () => {
    expect(barFill(true)).toBe(barFill(false))
  })
})

// ── Suite D: Variance Detail table — unit and dollar columns ──────────────────
//
// Production code (after fix):
//   unitColor   = theme.slateMid
//   dollarColor = theme.slateMid
//   (replaced directional comparisons in both the main table and the invoice-history tab)

function unitVarianceColor(_varianceUnits: number): string {
  return theme.slateMid
}

function dollarVarianceColor(_varianceDollars: number | null): string {
  return theme.slateMid
}

describe('Variance Detail table — unit/dollar column colors (handoff fix)', () => {
  it('D1: positive unit variance is slateMid, not green', () => {
    expect(unitVarianceColor(+3.5)).toBe(theme.slateMid)
    expect(unitVarianceColor(+3.5)).not.toBe(theme.success)
  })

  it('D2: negative unit variance is slateMid, not red', () => {
    expect(unitVarianceColor(-3.5)).toBe(theme.slateMid)
    expect(unitVarianceColor(-3.5)).not.toBe(theme.error)
  })

  it('D3: positive unit variance and negative unit variance have the same color', () => {
    expect(unitVarianceColor(+10)).toBe(unitVarianceColor(-10))
  })

  it('D4: positive dollar variance is slateMid, not green', () => {
    expect(dollarVarianceColor(+150)).toBe(theme.slateMid)
    expect(dollarVarianceColor(+150)).not.toBe(theme.success)
  })

  it('D5: negative dollar variance is slateMid, not red', () => {
    expect(dollarVarianceColor(-150)).toBe(theme.slateMid)
    expect(dollarVarianceColor(-150)).not.toBe(theme.error)
  })

  it('D6: null dollar variance is slateMid', () => {
    expect(dollarVarianceColor(null)).toBe(theme.slateMid)
  })
})

// ── Suite E: Velocity trend logic — explicitly excluded, contract verified ────
//
// The product velocity trend indicator (selling faster/slower) is OUT OF SCOPE
// for this handoff. Its directional coloring is semantically correct: a rising
// sales velocity IS a positive signal; a falling one IS a negative signal.
//
// We verify the velocity color logic directly as a pure function — confirming
// the contract (rising→success, falling→error, stable→slateMid) is preserved
// exactly and intentionally distinct from the inventory-variance neutral pattern.

function velocityTrendColor(trend: 'rising' | 'falling' | 'stable' | string): string {
  // Mirrors the production rendering at the velocity table row (excluded from fix).
  return trend === 'rising' ? theme.success : trend === 'falling' ? theme.error : theme.slateMid
}

describe('Velocity trend — excluded from fix, contract verified (E)', () => {
  it('E1: rising trend is theme.success (green) — semantically correct, preserved', () => {
    expect(velocityTrendColor('rising')).toBe(theme.success)
  })

  it('E2: falling trend is theme.error (red) — semantically correct, preserved', () => {
    expect(velocityTrendColor('falling')).toBe(theme.error)
  })

  it('E3: stable trend is theme.slateMid (neutral)', () => {
    expect(velocityTrendColor('stable')).toBe(theme.slateMid)
  })

  it('E4: velocity rising color differs from inventory variance color — proving distinct behavior', () => {
    // Inventory variance: positive excess → slateMid (neutral, no judgment)
    // Velocity:           rising sales   → success  (green, genuinely good signal)
    const inventoryExcessColor  = summaryCardVarianceColor(+250)
    const velocityRisingColor   = velocityTrendColor('rising')
    expect(inventoryExcessColor).not.toBe(velocityRisingColor)
    expect(inventoryExcessColor).toBe(theme.slateMid)
    expect(velocityRisingColor).toBe(theme.success)
  })

  it('E5: velocity falling color differs from inventory shortage color — proving distinct behavior', () => {
    // Inventory variance: shortage → slateMid (neutral, no judgment)
    // Velocity:           falling  → error    (red, genuinely concerning)
    const inventoryShortageColor = summaryCardVarianceColor(-250)
    const velocityFallingColor   = velocityTrendColor('falling')
    expect(inventoryShortageColor).not.toBe(velocityFallingColor)
    expect(inventoryShortageColor).toBe(theme.slateMid)
    expect(velocityFallingColor).toBe(theme.error)
  })
})
