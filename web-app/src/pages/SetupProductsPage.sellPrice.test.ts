/**
 * Tests for the sellPrice + inline GP% feature in SetupProductsPage.
 *
 * Updated for GST-adjusted GP% formula — sellPrice is inc-GST (menu price),
 * costPrice is ex-GST (invoice price). computeGpPercent now requires gstPercent.
 *
 * All GP% expected values are hand-verified with the new formula:
 *   sellPriceExGst = sellPrice / (1 + gstPercent / 100)
 *   GP% = Math.round(((sellPriceExGst - costPrice) / sellPriceExGst) * 100)
 */

import { describe, it, expect } from 'vitest'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProductStub = {
  id: string
  name: string
  costPrice: number | null
  sellPrice: number | null
  gstPercent: number | null
}

// ── Helpers mirroring the production logic ────────────────────────────────────

/**
 * GP% formula — mirrors computeGpPercent in SetupProductsPage.tsx.
 * sellPrice is inc-GST; costPrice is ex-GST.
 * Returns null when any value is missing — never guesses a GST rate.
 */
function computeGpPercent(
  sellPrice: number | null,
  costPrice: number | null,
  gstPercent: number | null,
): number | null {
  if (sellPrice == null || costPrice == null || gstPercent == null) return null
  if (sellPrice <= 0) return null
  const sellPriceExGst = sellPrice / (1 + gstPercent / 100)
  if (sellPriceExGst <= 0) return null
  return Math.round(((sellPriceExGst - costPrice) / sellPriceExGst) * 100)
}

/**
 * Returns the text shown in the Sell Price cell (non-editing state).
 * Mirrors the renderCell branch for field === 'sellPrice'.
 */
function sellPriceCellText(p: ProductStub): string {
  if (p.sellPrice == null) return '—'
  const gpPct = computeGpPercent(p.sellPrice, p.costPrice, p.gstPercent)
  if (gpPct != null) return `$${p.sellPrice.toFixed(2)} (${gpPct}%)`
  // Nudge: cost price gap is more fundamental than GST gap
  if (p.costPrice == null) return `$${p.sellPrice.toFixed(2)} (add cost price for GP%)`
  if (p.gstPercent == null) return `$${p.sellPrice.toFixed(2)} (add GST info for GP%)`
  return `$${p.sellPrice.toFixed(2)}`
}

/**
 * Mirrors displayValue for sellPrice — the raw string used as the input's
 * initial value when editing starts.
 */
function displayValueSellPrice(p: ProductStub): string {
  return p.sellPrice != null ? p.sellPrice.toFixed(2) : ''
}

/**
 * Mirrors buildUpdatePayload for sellPrice.
 */
function buildSellPricePayload(raw: string): { sellPrice: number | null } {
  const trimmed = raw.trim()
  const n = trimmed === '' ? null : Number(trimmed)
  const sellPrice = n != null && Number.isFinite(n) && n >= 0 ? n : null
  return { sellPrice }
}

// ── Suite A: GP% calculation ──────────────────────────────────────────────────

describe('SetupProductsPage — sellPrice GP% calculation (GST-adjusted)', () => {
  // Hand-verify: $3.50 inc-GST sell, $1.12 ex-GST cost, 15% NZ GST
  //   sellExGst = 3.50 / 1.15 = 3.04347…
  //   GP% = Math.round(((3.04347 - 1.12) / 3.04347) * 100) = Math.round(63.19…) = 63
  it('computes GST-adjusted GP% correctly: $3.50 sell (inc), $1.12 cost (ex), 15% GST → 63%', () => {
    expect(computeGpPercent(3.50, 1.12, 15)).toBe(63)
  })

  it('rounds to nearest integer — $10 sell (inc), $3 cost (ex), 15% GST', () => {
    // sellExGst = 10 / 1.15 = 8.6957…
    // GP% = Math.round(((8.6957 - 3) / 8.6957) * 100) = Math.round(65.50…) = 66
    expect(computeGpPercent(10, 3, 15)).toBe(66)
  })

  it('10% AU GST produces a correctly different result', () => {
    // sellExGst = 10 / 1.10 = 9.0909…
    // GP% = Math.round(((9.0909 - 3) / 9.0909) * 100) = Math.round(67.0…) = 67
    expect(computeGpPercent(10, 3, 10)).toBe(67)
    expect(computeGpPercent(10, 3, 10)).not.toBe(computeGpPercent(10, 3, 15))
  })

  it('returns null when sellPrice is null', () => {
    expect(computeGpPercent(null, 5.00, 15)).toBeNull()
  })

  it('returns null when costPrice is null', () => {
    expect(computeGpPercent(10.00, null, 15)).toBeNull()
  })

  it('returns null when gstPercent is null — honest-gap rule, same as missing cost price', () => {
    expect(computeGpPercent(10.00, 5.00, null)).toBeNull()
  })

  it('returns null when all values are null', () => {
    expect(computeGpPercent(null, null, null)).toBeNull()
  })

  it('returns null when sellPrice is zero (avoids divide-by-zero)', () => {
    expect(computeGpPercent(0, 0, 15)).toBeNull()
  })

  it('handles 100% GP% when cost price is 0 (gifted product)', () => {
    // sellExGst = 10/1.15 = 8.6957…; (8.6957 - 0)/8.6957 = 100%
    expect(computeGpPercent(10.00, 0, 15)).toBe(100)
  })

  it('handles negative GP% when cost is above the GST-adjusted sell price', () => {
    // sellExGst = 5/1.15 = 4.3478…; (4.3478 - 8) / 4.3478 = -84.0…
    expect(computeGpPercent(5.00, 8.00, 15)).toBe(-84)
  })
})

// ── Suite B: display label ────────────────────────────────────────────────────

describe('SetupProductsPage — sellPrice cell display labels', () => {
  it('shows $X.XX (Y%) when sell price, cost price, and GST are all present', () => {
    // Gin 700ml: $42 inc-GST sell, $28 ex-GST cost, 15% GST
    // sellExGst = 42/1.15 = 36.5217…; GP% = Math.round((8.5217/36.5217)*100) = Math.round(23.33…) = 23
    const p: ProductStub = { id: 'p1', name: 'Gin 700ml', costPrice: 28.00, sellPrice: 42.00, gstPercent: 15 }
    expect(sellPriceCellText(p)).toBe('$42.00 (23%)')
  })

  it('shows "add cost price for GP%" when cost price is missing', () => {
    const p: ProductStub = { id: 'p2', name: 'Mystery Spirit', costPrice: null, sellPrice: 3.50, gstPercent: 15 }
    expect(sellPriceCellText(p)).toBe('$3.50 (add cost price for GP%)')
  })

  it('shows "add GST info for GP%" when GST% is missing (new honest-gap messaging)', () => {
    const p: ProductStub = { id: 'p3', name: 'Spirit', costPrice: 15.00, sellPrice: 28.00, gstPercent: null }
    expect(sellPriceCellText(p)).toBe('$28.00 (add GST info for GP%)')
  })

  it('shows "add cost price for GP%" (not "add GST info") when both cost and GST are missing — cost is the more fundamental gap', () => {
    const p: ProductStub = { id: 'p4', name: 'Unknown', costPrice: null, sellPrice: 10.00, gstPercent: null }
    expect(sellPriceCellText(p)).toBe('$10.00 (add cost price for GP%)')
  })

  it('shows — when no sell price is set', () => {
    const p: ProductStub = { id: 'p5', name: 'Sauvignon Blanc', costPrice: 15.00, sellPrice: null, gstPercent: 15 }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('shows — when both sell and cost price are missing', () => {
    const p: ProductStub = { id: 'p6', name: 'Uncosted Product', costPrice: null, sellPrice: null, gstPercent: null }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('formats price to exactly two decimal places', () => {
    const p: ProductStub = { id: 'p7', name: 'Beer Pint', costPrice: null, sellPrice: 8, gstPercent: null }
    expect(sellPriceCellText(p)).toContain('$8.00')
  })
})

// ── Suite C: buildUpdatePayload for sellPrice ─────────────────────────────────

describe('SetupProductsPage — buildUpdatePayload for sellPrice', () => {
  it('parses a valid price string to a number', () => {
    expect(buildSellPricePayload('12.50')).toEqual({ sellPrice: 12.50 })
  })

  it('stores null when input is empty string (field cleared)', () => {
    expect(buildSellPricePayload('')).toEqual({ sellPrice: null })
  })

  it('stores null when input is whitespace only', () => {
    expect(buildSellPricePayload('   ')).toEqual({ sellPrice: null })
  })

  it('stores null when input is non-numeric', () => {
    expect(buildSellPricePayload('abc')).toEqual({ sellPrice: null })
  })

  it('stores null when input is negative (sell price cannot be negative)', () => {
    expect(buildSellPricePayload('-5')).toEqual({ sellPrice: null })
  })

  it('stores 0 as a valid sell price', () => {
    expect(buildSellPricePayload('0')).toEqual({ sellPrice: 0 })
  })
})

// ── Suite D: displayValue for sellPrice ──────────────────────────────────────

describe('SetupProductsPage — displayValue for sellPrice', () => {
  it('returns the price as a two-decimal string when set', () => {
    const p: ProductStub = { id: 'p1', name: 'Gin', costPrice: null, sellPrice: 18.5, gstPercent: 15 }
    expect(displayValueSellPrice(p)).toBe('18.50')
  })

  it('returns empty string when sell price is null (no pre-fill)', () => {
    const p: ProductStub = { id: 'p2', name: 'Gin', costPrice: null, sellPrice: null, gstPercent: null }
    expect(displayValueSellPrice(p)).toBe('')
  })
})
