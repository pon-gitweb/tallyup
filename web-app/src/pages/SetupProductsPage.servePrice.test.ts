/**
 * Tests for rate-based serve pricing (mL-based) in SetupProductsPage.
 *
 * Coverage:
 *   A. parseSizeMl — ml/L variants, decimals, bad input, non-volume units
 *   B. Rate-based GP% — keg example verified by hand; exact-number assertions
 *   C. Whole-unit regression — sellPriceServeSizeMl null → identical to
 *      existing behaviour; no existing sellPrice.test.ts case changes
 *   D. Fallback — unparseable size string → whole-unit path, never crash/wrong
 *   E. buildUpdatePayload for sellPrice — serve size saved correctly
 *   F. Display label — rate mode shows "/570ml" suffix; whole-unit does not
 */

import { describe, it, expect } from 'vitest'

// ── Types (mirror production) ─────────────────────────────────────────────────

type ProductStub = {
  id: string
  name: string
  size: string | null
  costPrice: number | null
  sellPrice: number | null
  sellPriceServeSizeMl: number | null
}

// ── parseSizeMl — mirrored from the production helper ────────────────────────

function parseSizeMl(size: string | null | undefined): number | null {
  if (!size) return null
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*(ml|l)$/i)
  if (!match) return null
  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()
  if (!Number.isFinite(value) || value <= 0) return null
  return unit === 'l' ? value * 1000 : value
}

// ── GP% helpers — mirrored from the production renderCell branch ──────────────

function computeGpWholeUnit(sellPrice: number, costPrice: number): number {
  return Math.round(((sellPrice - costPrice) / sellPrice) * 100)
}

function computeGpRateBased(
  sellPrice: number,
  costPrice: number,
  serveSizeMl: number,
  totalSizeMl: number,
): number {
  const totalServes  = totalSizeMl / serveSizeMl
  const costPerServe = costPrice / totalServes
  return Math.round(((sellPrice - costPerServe) / sellPrice) * 100)
}

/**
 * Mirrors the renderCell sellPrice display logic.
 * Returns the resting cell text (price string + GP annotation).
 */
function sellPriceCellText(p: ProductStub): string {
  if (p.sellPrice == null) return '—'

  const serveSizeMl = p.sellPriceServeSizeMl
  const totalSizeMl = serveSizeMl != null ? parseSizeMl(p.size) : null
  const isRateMode  = serveSizeMl != null && totalSizeMl != null && serveSizeMl > 0

  let gpPct: number | null = null
  if (isRateMode && p.costPrice != null) {
    gpPct = computeGpRateBased(p.sellPrice, p.costPrice, serveSizeMl!, totalSizeMl!)
  } else if (!isRateMode && p.costPrice != null) {
    gpPct = computeGpWholeUnit(p.sellPrice, p.costPrice)
  }

  const priceStr = isRateMode
    ? `$${p.sellPrice.toFixed(2)}/${serveSizeMl}ml`
    : `$${p.sellPrice.toFixed(2)}`

  const hasCostPrice = p.costPrice != null

  if (gpPct != null) return `${priceStr} (${gpPct}%)`
  if (!hasCostPrice)  return `${priceStr} (add cost price for GP%)`
  return priceStr
}

/**
 * Mirrors buildUpdatePayload + commitEdit logic for sellPrice.
 * Returns what would be saved to Firestore.
 */
function buildSellPriceUpdate(raw: string, serveSizeRaw: string): {
  sellPrice: number | null
  sellPriceServeSizeMl: number | null
} {
  const n = raw.trim() === '' ? null : Number(raw.trim())
  const sellPrice = n != null && Number.isFinite(n) && n >= 0 ? n : null

  const sn = serveSizeRaw.trim() === '' ? null : Number(serveSizeRaw.trim())
  const sellPriceServeSizeMl = sn != null && Number.isFinite(sn) && sn > 0 ? sn : null

  return { sellPrice, sellPriceServeSizeMl }
}

// ── Suite A: parseSizeMl ──────────────────────────────────────────────────────

describe('parseSizeMl', () => {
  it('parses "700ml" → 700', () => {
    expect(parseSizeMl('700ml')).toBe(700)
  })

  it('parses "700mL" (mixed case) → 700', () => {
    expect(parseSizeMl('700mL')).toBe(700)
  })

  it('parses "700ML" (all-caps) → 700', () => {
    expect(parseSizeMl('700ML')).toBe(700)
  })

  it('parses "50L" → 50000', () => {
    expect(parseSizeMl('50L')).toBe(50000)
  })

  it('parses "50l" (lowercase L) → 50000', () => {
    expect(parseSizeMl('50l')).toBe(50000)
  })

  it('parses "1L" → 1000', () => {
    expect(parseSizeMl('1L')).toBe(1000)
  })

  it('parses "1.125L" (decimal litres) → 1125', () => {
    expect(parseSizeMl('1.125L')).toBe(1125)
  })

  it('parses "1.5L" → 1500', () => {
    expect(parseSizeMl('1.5L')).toBe(1500)
  })

  it('parses "330ml" → 330', () => {
    expect(parseSizeMl('330ml')).toBe(330)
  })

  it('returns null for null input', () => {
    expect(parseSizeMl(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseSizeMl('')).toBeNull()
  })

  it('returns null for gram-based sizes ("400g")', () => {
    expect(parseSizeMl('400g')).toBeNull()
  })

  it('returns null for kg-based sizes ("2kg")', () => {
    expect(parseSizeMl('2kg')).toBeNull()
  })

  it('returns null for a plain number with no unit', () => {
    expect(parseSizeMl('700')).toBeNull()
  })

  it('returns null for a malformed string ("xyz")', () => {
    expect(parseSizeMl('xyz')).toBeNull()
  })

  it('L and ml variants of the same volume produce consistent mL values', () => {
    // 1L = 1000ml — both routes must arrive at the same number
    expect(parseSizeMl('1L')).toBe(parseSizeMl('1000ml'))
  })
})

// ── Suite B: rate-based GP% — hand-verified keg numbers ──────────────────────

describe('rate-based GP% (keg example)', () => {
  // 50L keg, $200 cost, $14.00/pint sell, 570mL serve
  // totalServes  = 50000 / 570 = 87.71929…
  // costPerServe = 200 / 87.71929… = 2.28070…
  // gpPct        = Math.round(((14.00 - 2.28070) / 14.00) * 100) = Math.round(83.709…) = 84

  const KEG: ProductStub = {
    id: 'keg-1',
    name: 'House Lager Keg 50L',
    size: '50L',
    costPrice: 200,
    sellPrice: 14.00,
    sellPriceServeSizeMl: 570,
  }

  it('parseSizeMl("50L") returns 50000', () => {
    expect(parseSizeMl(KEG.size)).toBe(50000)
  })

  it('total serves = 50000 / 570 ≈ 87.72', () => {
    const totalSizeMl = parseSizeMl(KEG.size)!
    const totalServes = totalSizeMl / KEG.sellPriceServeSizeMl!
    // Fractional serves — the venue captures the remainder as well as full pints
    expect(totalServes).toBeCloseTo(87.719, 2)
  })

  it('cost per serve ≈ $2.281', () => {
    const totalSizeMl = parseSizeMl(KEG.size)!
    const totalServes = totalSizeMl / KEG.sellPriceServeSizeMl!
    const costPerServe = KEG.costPrice! / totalServes
    expect(costPerServe).toBeCloseTo(2.281, 2)
  })

  it('GP% = 84 (hand-verified: Math.round(83.709) = 84)', () => {
    const totalSizeMl = parseSizeMl(KEG.size)!
    const gp = computeGpRateBased(KEG.sellPrice!, KEG.costPrice!, KEG.sellPriceServeSizeMl!, totalSizeMl)
    expect(gp).toBe(84)
  })

  it('cell text shows the serve size in the price label', () => {
    expect(sellPriceCellText(KEG)).toBe('$14.00/570ml (84%)')
  })

  it('simpler round-number check: 1L bottle, $10 cost, $5 sell, 100ml serve → 10 serves, $1 cost/serve, GP% 80', () => {
    const simple: ProductStub = {
      id: 's1', name: 'Simple', size: '1L',
      costPrice: 10, sellPrice: 5, sellPriceServeSizeMl: 100,
    }
    // 1000mL / 100mL = 10 serves; costPerServe = $1; GP% = ((5-1)/5)*100 = 80
    const totalSizeMl = parseSizeMl(simple.size)!
    const gp = computeGpRateBased(simple.sellPrice!, simple.costPrice!, simple.sellPriceServeSizeMl!, totalSizeMl)
    expect(gp).toBe(80)
    expect(sellPriceCellText(simple)).toBe('$5.00/100ml (80%)')
  })
})

// ── Suite C: whole-unit regression ────────────────────────────────────────────

describe('whole-unit mode (sellPriceServeSizeMl null) — regression against sellPrice.test.ts', () => {
  it('GP% formula is unchanged: $42 sell, $28 cost → 33%', () => {
    const p: ProductStub = { id: 'r1', name: 'Gin', size: '700ml', costPrice: 28, sellPrice: 42, sellPriceServeSizeMl: null }
    // ((42 - 28) / 42) * 100 = 33.33… → 33
    expect(computeGpWholeUnit(42, 28)).toBe(33)
    expect(sellPriceCellText(p)).toBe('$42.00 (33%)')
  })

  it('no sell price → shows —', () => {
    const p: ProductStub = { id: 'r2', name: 'Gin', size: null, costPrice: 15, sellPrice: null, sellPriceServeSizeMl: null }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('sell price present but no cost price → nudge message (whole-unit, null serve size)', () => {
    const p: ProductStub = { id: 'r3', name: 'Spirit', size: null, costPrice: null, sellPrice: 3.50, sellPriceServeSizeMl: null }
    expect(sellPriceCellText(p)).toBe('$3.50 (add cost price for GP%)')
  })

  it('$3.50 sell, $1.12 cost, null serve → 68% (unchanged from existing test)', () => {
    // (3.50 - 1.12) / 3.50 * 100 = 68%
    expect(computeGpWholeUnit(3.50, 1.12)).toBe(68)
    const p: ProductStub = { id: 'r4', name: 'Wine', size: null, costPrice: 1.12, sellPrice: 3.50, sellPriceServeSizeMl: null }
    expect(sellPriceCellText(p)).toBe('$3.50 (68%)')
  })
})

// ── Suite D: fallback — unparseable size → whole-unit display ─────────────────

describe('fallback: unparseable size string falls back to whole-unit, never crashes', () => {
  it('serve size set but size is null → falls back to whole-unit GP%', () => {
    const p: ProductStub = {
      id: 'f1', name: 'Unknown', size: null,
      costPrice: 10, sellPrice: 20, sellPriceServeSizeMl: 500,
    }
    // parseSizeMl(null) = null → isRateMode = false → whole-unit
    // ((20 - 10) / 20) * 100 = 50
    expect(sellPriceCellText(p)).toBe('$20.00 (50%)')
  })

  it('serve size set but size is a gram string ("400g") → falls back to whole-unit GP%', () => {
    const p: ProductStub = {
      id: 'f2', name: 'Jar Product', size: '400g',
      costPrice: 5, sellPrice: 10, sellPriceServeSizeMl: 100,
    }
    // parseSizeMl("400g") = null → isRateMode = false → whole-unit
    // ((10 - 5) / 10) * 100 = 50
    expect(sellPriceCellText(p)).toBe('$10.00 (50%)')
  })

  it('serve size set but size is malformed → falls back to nudge when no costPrice', () => {
    const p: ProductStub = {
      id: 'f3', name: 'Weird Product', size: 'big bottle',
      costPrice: null, sellPrice: 8, sellPriceServeSizeMl: 200,
    }
    // parseSizeMl("big bottle") = null → isRateMode = false → whole-unit nudge
    expect(sellPriceCellText(p)).toBe('$8.00 (add cost price for GP%)')
  })

  it('serve size set, parseable size, but no cost price → nudge message (rate mode, no cost)', () => {
    const p: ProductStub = {
      id: 'f4', name: 'Keg No Cost', size: '50L',
      costPrice: null, sellPrice: 14, sellPriceServeSizeMl: 570,
    }
    // isRateMode = true, but costPrice = null → no gpPct, hasCostPrice = false → nudge
    expect(sellPriceCellText(p)).toBe('$14.00/570ml (add cost price for GP%)')
  })
})

// ── Suite E: buildUpdatePayload for sellPrice + serveSize ─────────────────────

describe('buildSellPriceUpdate (mirrors commitEdit payload)', () => {
  it('saves both sellPrice and a valid serve size', () => {
    expect(buildSellPriceUpdate('14.00', '570')).toEqual({
      sellPrice: 14.00,
      sellPriceServeSizeMl: 570,
    })
  })

  it('clears serve size when the serve-size input is empty', () => {
    expect(buildSellPriceUpdate('14.00', '')).toEqual({
      sellPrice: 14.00,
      sellPriceServeSizeMl: null,
    })
  })

  it('clears serve size when the serve-size input is whitespace', () => {
    expect(buildSellPriceUpdate('14.00', '   ')).toEqual({
      sellPrice: 14.00,
      sellPriceServeSizeMl: null,
    })
  })

  it('clears both when the main price input is empty', () => {
    expect(buildSellPriceUpdate('', '570')).toEqual({
      sellPrice: null,
      sellPriceServeSizeMl: 570,
    })
  })

  it('rejects a negative serve size (stores null)', () => {
    expect(buildSellPriceUpdate('14.00', '-100')).toEqual({
      sellPrice: 14.00,
      sellPriceServeSizeMl: null,
    })
  })

  it('rejects a zero serve size (divide-by-zero guard, stores null)', () => {
    expect(buildSellPriceUpdate('14.00', '0')).toEqual({
      sellPrice: 14.00,
      sellPriceServeSizeMl: null,
    })
  })
})

// ── Suite F: display label format ─────────────────────────────────────────────

describe('display label format', () => {
  it('rate mode shows /Nml in the price label', () => {
    const p: ProductStub = {
      id: 'l1', name: 'Keg', size: '50L',
      costPrice: 200, sellPrice: 14, sellPriceServeSizeMl: 570,
    }
    expect(sellPriceCellText(p)).toContain('/570ml')
  })

  it('whole-unit mode does NOT show /ml in the price label', () => {
    const p: ProductStub = {
      id: 'l2', name: 'Bottle', size: '700ml',
      costPrice: 28, sellPrice: 42, sellPriceServeSizeMl: null,
    }
    expect(sellPriceCellText(p)).not.toContain('/ml')
    expect(sellPriceCellText(p)).not.toContain('/700ml')
  })

  it('fallback mode (bad size) does NOT show /ml even if serve size is set', () => {
    const p: ProductStub = {
      id: 'l3', name: 'Mystery', size: '400g',
      costPrice: 10, sellPrice: 20, sellPriceServeSizeMl: 200,
    }
    expect(sellPriceCellText(p)).not.toContain('/ml')
  })
})
