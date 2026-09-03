/**
 * Tests for the sellPrice + inline GP% feature added to SetupProductsPage.
 *
 * Strategy: mirror the pure-function logic as standalone helpers — no React
 * or Firebase dependency needed.  Same pattern as the active-filter tests.
 *
 * Coverage:
 *   A. GP% calculation — correct formula, rounding, edge cases
 *   B. Display labels — correct strings for each scenario
 *   C. buildUpdatePayload for sellPrice — numeric, null, negative guard
 *   D. displayValue for sellPrice — raw decimal string
 */

import { describe, it, expect } from 'vitest'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProductStub = {
  id: string
  name: string
  costPrice: number | null
  sellPrice: number | null
}

// ── Helpers mirroring the production logic ────────────────────────────────────

/**
 * GP% formula — mirrors CraftIt's exact formula, reused here.
 * rrp = sellPrice, cogs = costPrice.
 * Returns null when either value is missing.
 */
function computeGpPercent(sellPrice: number | null, costPrice: number | null): number | null {
  if (sellPrice == null || costPrice == null) return null
  if (sellPrice === 0) return null          // avoid divide-by-zero
  return Math.round(((sellPrice - costPrice) / sellPrice) * 100)
}

/**
 * Returns the text shown in the Sell Price cell (non-editing state).
 * Mirrors the renderCell branch for field === 'sellPrice'.
 */
function sellPriceCellText(p: ProductStub): string {
  if (p.sellPrice == null) return '—'
  const gpPct = computeGpPercent(p.sellPrice, p.costPrice)
  if (gpPct != null) return `$${p.sellPrice.toFixed(2)} (${gpPct}%)`
  return `$${p.sellPrice.toFixed(2)} (add cost price for GP%)`
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

describe('SetupProductsPage — sellPrice GP% calculation', () => {
  it('computes GP% correctly with both values present', () => {
    // $3.50 sell, $1.12 cost → ((3.50 - 1.12) / 3.50) * 100 = 68%
    expect(computeGpPercent(3.50, 1.12)).toBe(68)
  })

  it('rounds to nearest integer', () => {
    // ((10 - 3) / 10) * 100 = 70.0 — exact
    expect(computeGpPercent(10, 3)).toBe(70)
    // ((7 - 3.33) / 7) * 100 ≈ 52.43 → 52
    expect(computeGpPercent(7, 3.33)).toBe(52)
  })

  it('returns null when sellPrice is null', () => {
    expect(computeGpPercent(null, 5.00)).toBeNull()
  })

  it('returns null when costPrice is null', () => {
    expect(computeGpPercent(10.00, null)).toBeNull()
  })

  it('returns null when both values are null', () => {
    expect(computeGpPercent(null, null)).toBeNull()
  })

  it('returns null when sellPrice is zero (avoids divide-by-zero)', () => {
    expect(computeGpPercent(0, 0)).toBeNull()
  })

  it('handles 100% GP% when cost price is 0', () => {
    // e.g. gifted product with zero cost
    expect(computeGpPercent(10.00, 0)).toBe(100)
  })

  it('handles negative GP% when cost is above sell price', () => {
    // Selling below cost
    expect(computeGpPercent(5.00, 8.00)).toBe(-60)
  })
})

// ── Suite B: display label ────────────────────────────────────────────────────

describe('SetupProductsPage — sellPrice cell display labels', () => {
  it('shows $X.XX (Y%) when both sell and cost price are present', () => {
    const p: ProductStub = { id: 'p1', name: 'Gin 700ml', costPrice: 28.00, sellPrice: 42.00 }
    // ((42 - 28) / 42) * 100 ≈ 33%
    expect(sellPriceCellText(p)).toBe('$42.00 (33%)')
  })

  it('shows nudge message when sell price is present but cost price is missing', () => {
    const p: ProductStub = { id: 'p2', name: 'Mystery Spirit', costPrice: null, sellPrice: 3.50 }
    expect(sellPriceCellText(p)).toBe('$3.50 (add cost price for GP%)')
  })

  it('shows — when no sell price is set', () => {
    const p: ProductStub = { id: 'p3', name: 'Sauvignon Blanc', costPrice: 15.00, sellPrice: null }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('shows — when both sell and cost price are missing', () => {
    const p: ProductStub = { id: 'p4', name: 'Uncosted Product', costPrice: null, sellPrice: null }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('formats price to exactly two decimal places', () => {
    const p: ProductStub = { id: 'p5', name: 'Beer Pint', costPrice: null, sellPrice: 8 }
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
    // Zero is a valid sell price (gifted/complimentary)
    expect(buildSellPricePayload('0')).toEqual({ sellPrice: 0 })
  })
})

// ── Suite D: displayValue for sellPrice ──────────────────────────────────────

describe('SetupProductsPage — displayValue for sellPrice', () => {
  it('returns the price as a two-decimal string when set', () => {
    const p: ProductStub = { id: 'p1', name: 'Gin', costPrice: null, sellPrice: 18.5 }
    expect(displayValueSellPrice(p)).toBe('18.50')
  })

  it('returns empty string when sell price is null (no pre-fill)', () => {
    const p: ProductStub = { id: 'p2', name: 'Gin', costPrice: null, sellPrice: null }
    expect(displayValueSellPrice(p)).toBe('')
  })
})
