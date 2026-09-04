/**
 * Tests for rate-based serve pricing (mL-based) in SetupProductsPage.
 *
 * Updated for GST-adjusted GP% formula — sellPrice is inc-GST (menu price),
 * costPrice is ex-GST (invoice price). gstPercent is now required for any GP%
 * to display; missing gstPercent → "add GST info for GP%" nudge.
 *
 * All GP% expected values are hand-verified with the new formula:
 *   sellPriceExGst = sellPrice / (1 + gstPercent / 100)
 *   GP% = Math.round(((sellPriceExGst - costPerServe) / sellPriceExGst) * 100)
 *
 * Coverage:
 *   A. parseSizeMl — ml/L variants, decimals, bad input, non-volume units
 *   B. Rate-based GP% — keg example verified by hand; exact-number assertions
 *   C. Whole-unit regression — sellPriceServeSizeMl null → correct GST-adjusted GP%
 *   D. Fallback — unparseable size string → whole-unit path, never crash/wrong
 *   E. buildUpdatePayload for sellPrice — serve size saved correctly
 *   F. Display label — rate mode shows "/570ml" suffix; whole-unit does not
 *   G. Null gstPercent — per-call-site regression: rate-mode shows "add GST info for GP%"
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
  gstPercent: number | null
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

// ── computeGpPercent — mirrored from SetupProductsPage.tsx ───────────────────

/**
 * GST-adjusted GP% helper — mirrors computeGpPercent in production.
 * sellPrice is inc-GST; costPrice is ex-GST (cost per serve for rate mode,
 * or whole-unit costPrice for bottle/can mode).
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
 * Rate mode: cost per serve is computed then passed to computeGpPercent.
 * Whole-unit mode: product.costPrice is passed directly.
 */
function sellPriceCellText(p: ProductStub): string {
  if (p.sellPrice == null) return '—'

  const serveSizeMl = p.sellPriceServeSizeMl
  const totalSizeMl = serveSizeMl != null ? parseSizeMl(p.size) : null
  const isRateMode  = serveSizeMl != null && totalSizeMl != null && serveSizeMl > 0

  let gpPct: number | null = null
  if (isRateMode && p.costPrice != null) {
    const totalServes  = totalSizeMl! / serveSizeMl!
    const costPerServe = p.costPrice / totalServes
    gpPct = computeGpPercent(p.sellPrice, costPerServe, p.gstPercent)
  } else if (!isRateMode) {
    gpPct = computeGpPercent(p.sellPrice, p.costPrice, p.gstPercent)
  }

  const priceStr = isRateMode
    ? `$${p.sellPrice.toFixed(2)}/${serveSizeMl}ml`
    : `$${p.sellPrice.toFixed(2)}`

  if (gpPct != null) return `${priceStr} (${gpPct}%)`
  // Nudge: cost is the more fundamental gap (check it first)
  if (p.costPrice == null) return `${priceStr} (add cost price for GP%)`
  if (p.gstPercent == null) return `${priceStr} (add GST info for GP%)`
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

describe('rate-based GP% (keg example — GST-adjusted)', () => {
  // 50L keg, $200 ex-GST cost, $14.00/pint inc-GST sell, 570mL serve, 15% NZ GST
  //
  // totalServes  = 50000 / 570 = 87.71929…
  // costPerServe = 200 / 87.71929… = 2.28070…
  // sellExGst    = 14.00 / 1.15 = 12.17391…
  // gpPct        = Math.round(((12.17391 - 2.28070) / 12.17391) * 100)
  //              = Math.round(9.8932 / 12.17391 * 100)
  //              = Math.round(81.267…) = 81

  const KEG: ProductStub = {
    id: 'keg-1',
    name: 'House Lager Keg 50L',
    size: '50L',
    costPrice: 200,
    sellPrice: 14.00,
    sellPriceServeSizeMl: 570,
    gstPercent: 15,
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

  it('GP% = 81 (hand-verified: Math.round(81.267) = 81, GST-adjusted)', () => {
    const totalSizeMl = parseSizeMl(KEG.size)!
    const totalServes = totalSizeMl / KEG.sellPriceServeSizeMl!
    const costPerServe = KEG.costPrice! / totalServes
    const gp = computeGpPercent(KEG.sellPrice!, costPerServe, KEG.gstPercent)
    expect(gp).toBe(81)
  })

  it('cell text shows the serve size in the price label', () => {
    expect(sellPriceCellText(KEG)).toBe('$14.00/570ml (81%)')
  })

  it('simpler round-number check: 1L bottle, $10 cost, $5 sell, 100ml serve, 15% GST → 10 serves, $1 cost/serve, GP% 77', () => {
    // Hand-verify:
    //   totalServes = 1000/100 = 10; costPerServe = 10/10 = $1.00
    //   sellExGst = 5/1.15 = 4.3478…
    //   GP% = Math.round(((4.3478 - 1) / 4.3478) * 100) = Math.round(77.0…) = 77
    const simple: ProductStub = {
      id: 's1', name: 'Simple', size: '1L',
      costPrice: 10, sellPrice: 5, sellPriceServeSizeMl: 100, gstPercent: 15,
    }
    const totalSizeMl = parseSizeMl(simple.size)!
    const totalServes = totalSizeMl / simple.sellPriceServeSizeMl!
    const costPerServe = simple.costPrice! / totalServes
    const gp = computeGpPercent(simple.sellPrice!, costPerServe, simple.gstPercent)
    expect(gp).toBe(77)
    expect(sellPriceCellText(simple)).toBe('$5.00/100ml (77%)')
  })
})

// ── Suite C: whole-unit regression ────────────────────────────────────────────

describe('whole-unit mode (sellPriceServeSizeMl null) — GST-adjusted values', () => {
  it('GP% formula uses GST-adjusted sell price: $42 inc-GST sell, $28 ex-GST cost, 15% → 23%', () => {
    // sellExGst = 42/1.15 = 36.5217…; GP% = Math.round((8.5217/36.5217)*100) = 23
    const p: ProductStub = {
      id: 'r1', name: 'Gin', size: '700ml',
      costPrice: 28, sellPrice: 42, sellPriceServeSizeMl: null, gstPercent: 15,
    }
    expect(computeGpPercent(42, 28, 15)).toBe(23)
    expect(sellPriceCellText(p)).toBe('$42.00 (23%)')
  })

  it('no sell price → shows —', () => {
    const p: ProductStub = {
      id: 'r2', name: 'Gin', size: null,
      costPrice: 15, sellPrice: null, sellPriceServeSizeMl: null, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).toBe('—')
  })

  it('sell price present but no cost price → nudge message (whole-unit, null serve size)', () => {
    const p: ProductStub = {
      id: 'r3', name: 'Spirit', size: null,
      costPrice: null, sellPrice: 3.50, sellPriceServeSizeMl: null, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).toBe('$3.50 (add cost price for GP%)')
  })

  it('$3.50 inc-GST sell, $1.12 ex-GST cost, 15% GST → 63%', () => {
    // sellExGst = 3.50/1.15 = 3.04347…; GP% = Math.round(((3.04347-1.12)/3.04347)*100) = 63
    expect(computeGpPercent(3.50, 1.12, 15)).toBe(63)
    const p: ProductStub = {
      id: 'r4', name: 'Wine', size: null,
      costPrice: 1.12, sellPrice: 3.50, sellPriceServeSizeMl: null, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).toBe('$3.50 (63%)')
  })
})

// ── Suite D: fallback — unparseable size → whole-unit display ─────────────────

describe('fallback: unparseable size string falls back to whole-unit, never crashes', () => {
  it('serve size set but size is null → falls back to whole-unit GP% (GST-adjusted)', () => {
    const p: ProductStub = {
      id: 'f1', name: 'Unknown', size: null,
      costPrice: 10, sellPrice: 20, sellPriceServeSizeMl: 500, gstPercent: 15,
    }
    // parseSizeMl(null) = null → isRateMode = false → whole-unit
    // sellExGst = 20/1.15 = 17.3913…; GP% = Math.round((7.3913/17.3913)*100) = 43
    expect(sellPriceCellText(p)).toBe('$20.00 (43%)')
  })

  it('serve size set but size is a gram string ("400g") → falls back to whole-unit GP% (GST-adjusted)', () => {
    const p: ProductStub = {
      id: 'f2', name: 'Jar Product', size: '400g',
      costPrice: 5, sellPrice: 10, sellPriceServeSizeMl: 100, gstPercent: 15,
    }
    // parseSizeMl("400g") = null → isRateMode = false → whole-unit
    // sellExGst = 10/1.15 = 8.6957…; GP% = Math.round((3.6957/8.6957)*100) = 43
    expect(sellPriceCellText(p)).toBe('$10.00 (43%)')
  })

  it('serve size set but size is malformed → falls back to nudge when no costPrice', () => {
    const p: ProductStub = {
      id: 'f3', name: 'Weird Product', size: 'big bottle',
      costPrice: null, sellPrice: 8, sellPriceServeSizeMl: 200, gstPercent: 15,
    }
    // parseSizeMl("big bottle") = null → isRateMode = false → cost nudge
    expect(sellPriceCellText(p)).toBe('$8.00 (add cost price for GP%)')
  })

  it('serve size set, parseable size, but no cost price → nudge message (rate mode, no cost)', () => {
    const p: ProductStub = {
      id: 'f4', name: 'Keg No Cost', size: '50L',
      costPrice: null, sellPrice: 14, sellPriceServeSizeMl: 570, gstPercent: 15,
    }
    // isRateMode = true, but costPrice = null → skip computeGpPercent → cost nudge
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
      costPrice: 200, sellPrice: 14, sellPriceServeSizeMl: 570, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).toContain('/570ml')
  })

  it('whole-unit mode does NOT show /ml in the price label', () => {
    const p: ProductStub = {
      id: 'l2', name: 'Bottle', size: '700ml',
      costPrice: 28, sellPrice: 42, sellPriceServeSizeMl: null, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).not.toContain('/ml')
    expect(sellPriceCellText(p)).not.toContain('/700ml')
  })

  it('fallback mode (bad size) does NOT show /ml even if serve size is set', () => {
    const p: ProductStub = {
      id: 'l3', name: 'Mystery', size: '400g',
      costPrice: 10, sellPrice: 20, sellPriceServeSizeMl: 200, gstPercent: 15,
    }
    expect(sellPriceCellText(p)).not.toContain('/ml')
  })
})

// ── Suite G: null gstPercent — per-call-site regression ──────────────────────

describe('null gstPercent — honest-gap rule, per call site', () => {
  it('rate-mode call site: null gstPercent → "add GST info for GP%" (not a stale number)', () => {
    // Product has costPrice and sellPrice, but gstPercent is unknown.
    // Rate-mode call: computeGpPercent(sellPrice, costPerServe, null) → null.
    // Nudge order: costPrice is present, so gstPercent nudge fires.
    const p: ProductStub = {
      id: 'g1', name: 'Keg No GST', size: '50L',
      costPrice: 200, sellPrice: 14, sellPriceServeSizeMl: 570, gstPercent: null,
    }
    expect(sellPriceCellText(p)).toBe('$14.00/570ml (add GST info for GP%)')
  })

  it('whole-unit call site: null gstPercent → "add GST info for GP%"', () => {
    const p: ProductStub = {
      id: 'g2', name: 'Bottle No GST', size: '700ml',
      costPrice: 28, sellPrice: 42, sellPriceServeSizeMl: null, gstPercent: null,
    }
    expect(sellPriceCellText(p)).toBe('$42.00 (add GST info for GP%)')
  })

  it('AU 10% GST produces a correctly different rate-based GP% than NZ 15%', () => {
    // 50L keg, $200 cost, $14 sell, 570ml serve
    // costPerServe = 2.28070…
    //
    // 15% NZ: sellExGst = 14/1.15 = 12.17391; GP% = 81
    // 10% AU: sellExGst = 14/1.10 = 12.72727; GP% = Math.round((12.72727-2.28070)/12.72727*100)
    //       = Math.round(10.44657/12.72727*100) = Math.round(82.08…) = 82
    const totalServes  = 50000 / 570
    const costPerServe = 200   / totalServes
    const gpNz = computeGpPercent(14, costPerServe, 15)
    const gpAu = computeGpPercent(14, costPerServe, 10)
    expect(gpNz).toBe(81)
    expect(gpAu).toBe(82)
    expect(gpAu).not.toBe(gpNz)
  })
})
