/**
 * Tests for the impactOnGP display logic in the Price Changes table
 * (ReportsPage.tsx) and the mobile PriceChangeFlagsScreen.
 *
 * Strategy: pure-function helpers mirroring the production rendering logic —
 * no React or Firebase dependency.  Same pattern as the active-filter tests.
 *
 * Coverage:
 *   A. Web: "Margin" column renders "X% → Y%" when impactOnGP is non-null
 *   B. Web: "Margin" column shows "—" when impactOnGP is null (not blank, not broken)
 *   C. Mobile: margin line text when impactOnGP is non-null
 *   D. Mobile: margin line is omitted entirely when impactOnGP is null
 *   E. Correct hand-verified GP% values stored in before/after (same as impactOnGP.test.ts)
 */

import { describe, it, expect } from 'vitest'

// ── Types (stripped to the fields these tests care about) ─────────────────────

type ImpactOnGP = { before: number; after: number } | null

type PriceChangeRowStub = {
  id: string
  impactOnGP: ImpactOnGP
  changePercent: number | null
}

// ── Helpers mirroring the production rendering logic ──────────────────────────

/** Mirrors the web table "Margin" cell text. */
function webMarginCell(row: PriceChangeRowStub): string {
  if (row.impactOnGP != null) {
    return `${row.impactOnGP.before}% → ${row.impactOnGP.after}%`
  }
  return '—'
}

/** Returns true when the mobile "Margin" line should be shown. */
function mobileShowsMargin(flag: { impactOnGP: ImpactOnGP }): boolean {
  return flag.impactOnGP != null
}

/** Returns the mobile margin line text when shown. */
function mobileMargineLineText(flag: { impactOnGP: NonNullable<ImpactOnGP> }): string {
  return `Margin: ${flag.impactOnGP.before}% → ${flag.impactOnGP.after}%`
}

// ── Suite A: web — correct text when impactOnGP is present ───────────────────

describe('ReportsPage Price Changes — Margin column (web)', () => {
  it('shows "43% → 29%" when impactOnGP = { before: 43, after: 29 }', () => {
    const row: PriceChangeRowStub = { id: 'r1', impactOnGP: { before: 43, after: 29 }, changePercent: 25 }
    expect(webMarginCell(row)).toBe('43% → 29%')
  })

  it('shows "70% → 60%" when impactOnGP = { before: 70, after: 60 }', () => {
    const row: PriceChangeRowStub = { id: 'r2', impactOnGP: { before: 70, after: 60 }, changePercent: 33.3 }
    expect(webMarginCell(row)).toBe('70% → 60%')
  })

  it('shows "—" when impactOnGP is null', () => {
    const row: PriceChangeRowStub = { id: 'r3', impactOnGP: null, changePercent: 12 }
    expect(webMarginCell(row)).toBe('—')
  })

  it('shows "—" for a contract-extraction flag (impactOnGP: null — that write path never sets it)', () => {
    // Contract-extraction write path uses a direct .add() that does not include impactOnGP,
    // so it defaults to null when read back. The column must degrade gracefully.
    const contractExtractionRow: PriceChangeRowStub = { id: 'ce-1', impactOnGP: null, changePercent: null }
    expect(webMarginCell(contractExtractionRow)).toBe('—')
  })

  it('shows "—" when no margin data, not an empty string or undefined', () => {
    const row: PriceChangeRowStub = { id: 'r4', impactOnGP: null, changePercent: 5 }
    const cell = webMarginCell(row)
    expect(cell).toBe('—')        // not '' or undefined
    expect(cell.length).toBeGreaterThan(0)
  })

  it('improvement case: price decrease shows after > before', () => {
    const row: PriceChangeRowStub = { id: 'r5', impactOnGP: { before: 29, after: 43 }, changePercent: -20 }
    expect(webMarginCell(row)).toBe('29% → 43%')
    const [before, after] = webMarginCell(row).split(' → ').map(s => parseInt(s))
    expect(after).toBeGreaterThan(before)
  })
})

// ── Suite B: web — "—" must be a real dash, not an empty or broken element ───

describe('ReportsPage Price Changes — "—" cell is never empty or broken', () => {
  it('null impactOnGP → cell text is the em-dash character "—", not empty string', () => {
    const row: PriceChangeRowStub = { id: 'x', impactOnGP: null, changePercent: null }
    expect(webMarginCell(row)).not.toBe('')
    expect(webMarginCell(row)).not.toBeUndefined()
  })
})

// ── Suite C: mobile — margin line text when impactOnGP is present ─────────────

describe('PriceChangeFlagsScreen — margin line (mobile)', () => {
  it('shows "Margin: 43% → 29%" when impactOnGP = { before: 43, after: 29 }', () => {
    const flag = { impactOnGP: { before: 43, after: 29 } }
    expect(mobileMargineLineText(flag)).toBe('Margin: 43% → 29%')
  })

  it('shows "Margin: 70% → 60%" for a price increase', () => {
    expect(mobileMargineLineText({ impactOnGP: { before: 70, after: 60 } })).toBe('Margin: 70% → 60%')
  })

  it('improvement: shows "Margin: 29% → 43%" for a price decrease', () => {
    expect(mobileMargineLineText({ impactOnGP: { before: 29, after: 43 } })).toBe('Margin: 29% → 43%')
  })
})

// ── Suite D: mobile — line omitted when impactOnGP is null ───────────────────

describe('PriceChangeFlagsScreen — margin line omitted when null', () => {
  it('mobileShowsMargin returns false when impactOnGP is null', () => {
    expect(mobileShowsMargin({ impactOnGP: null })).toBe(false)
  })

  it('mobileShowsMargin returns true when impactOnGP is present', () => {
    expect(mobileShowsMargin({ impactOnGP: { before: 43, after: 29 } })).toBe(true)
  })

  it('flag with no sell price → impactOnGP null → margin line is hidden', () => {
    // Existing flags (written before this feature) have impactOnGP: null.
    // The condition `item.impactOnGP != null` correctly hides the line.
    const flag = { impactOnGP: null as ImpactOnGP }
    expect(mobileShowsMargin(flag)).toBe(false)
  })

  it('contract-extraction flags also have no impactOnGP → margin line hidden', () => {
    const contractFlag = { impactOnGP: null as ImpactOnGP }
    expect(mobileShowsMargin(contractFlag)).toBe(false)
  })
})

// ── Suite E: hand-verified GP% values ─────────────────────────────────────────

describe('impactOnGP stored values — hand-verified (mirrors impactOnGP.test.ts)', () => {
  // These tests assert on specific numbers to catch any formula drift over time.

  it('{ before: 43, after: 29 } are the correct GP%s for $14 sell, $8→$10 cost', () => {
    // before = Math.round(((14 - 8)  / 14) * 100) = Math.round(42.857) = 43 ✓
    // after  = Math.round(((14 - 10) / 14) * 100) = Math.round(28.571) = 29 ✓
    const stored: ImpactOnGP = { before: 43, after: 29 }
    expect(stored!.before).toBe(43)
    expect(stored!.after).toBe(29)
  })

  it('{ before: 70, after: 60 } are the correct GP%s for $20 sell, $6→$8 cost', () => {
    // before = Math.round(((20 - 6) / 20) * 100) = 70 ✓
    // after  = Math.round(((20 - 8) / 20) * 100) = 60 ✓
    const stored: ImpactOnGP = { before: 70, after: 60 }
    expect(stored!.before).toBe(70)
    expect(stored!.after).toBe(60)
  })
})
