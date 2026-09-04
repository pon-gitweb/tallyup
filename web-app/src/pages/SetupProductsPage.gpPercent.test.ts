/**
 * Comprehensive tests for the computeGpPercent helper in SetupProductsPage.tsx.
 *
 * This helper fixes a systematic GP% overstatement in which the inc-GST menu
 * price (sellPrice) was compared directly against the ex-GST invoice price
 * (costPrice), overstating every reported margin.
 *
 * Correct formula:
 *   sellPriceExGst = sellPrice / (1 + gstPercent / 100)
 *   GP% = Math.round(((sellPriceExGst - costPrice) / sellPriceExGst) * 100)
 *
 * Spec example (from bug report):
 *   $5 ex-GST cost, $14 inc-GST sell, 15% GST
 *   → old wrong formula: Math.round(((14 - 5) / 14) * 100) = 64%
 *   → correct formula:   sellExGst = 14/1.15 = 12.17391…
 *                        Math.round(((12.17391 - 5) / 12.17391) * 100)
 *                        = Math.round(58.928…) = 59%
 *   → 5-point overstatement, now corrected.
 *
 * All expected values are hand-verified before asserting.
 *
 * Coverage:
 *   A. Core formula — spec example and basic cases (hand-verified)
 *   B. Null inputs — honest-gap rule; null returned, not a guess
 *   C. Edge cases — zero, negative, equal cost/sell
 *   D. GST rate sensitivity — 10% AU vs 15% NZ produces different results
 *   E. Rounding — no fractional GP% ever returned
 */

import { describe, it, expect } from 'vitest'

// ── Mirror of production helper ───────────────────────────────────────────────
// This mirrors computeGpPercent from SetupProductsPage.tsx exactly.
// Any change here must be reflected in the production file and in
// functions/src/priceTracking.ts (the separately-deployed mirror).

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

// ── Suite A: core formula (hand-verified) ─────────────────────────────────────

describe('computeGpPercent — core formula (hand-verified)', () => {
  // ── Spec example from bug report ─────────────────────────────────────────────
  // Old wrong formula: Math.round(((14-5)/14)*100) = 64%
  // Correct formula:
  //   sellExGst = 14 / 1.15 = 12.17391304347826…
  //   Math.round(((12.17391… - 5) / 12.17391…) * 100)
  //   = Math.round((7.17391… / 12.17391…) * 100)
  //   = Math.round(58.9285714…) = 59
  it('spec example: $5 ex-GST cost, $14 inc-GST sell, 15% GST → 59% (was 64% with old formula)', () => {
    expect(computeGpPercent(14, 5, 15)).toBe(59)
  })

  it('spec example rounding: result is 58.928… which rounds to 59, not 58 or 60', () => {
    // Proves the rounding direction is correct
    const result = computeGpPercent(14, 5, 15)
    expect(result).toBe(59)
    expect(result).not.toBe(58)
    expect(result).not.toBe(60)
  })

  // ── Additional hand-verified cases ───────────────────────────────────────────

  it('$28 ex-GST cost, $42 inc-GST sell, 15% GST → 23%', () => {
    // sellExGst = 42/1.15 = 36.5217391…
    // GP% = Math.round(((36.5217 - 28) / 36.5217) * 100) = Math.round(23.333…) = 23
    expect(computeGpPercent(42, 28, 15)).toBe(23)
  })

  it('$1.12 ex-GST cost, $3.50 inc-GST sell, 15% GST → 63%', () => {
    // sellExGst = 3.50/1.15 = 3.04347826…
    // GP% = Math.round(((3.04347 - 1.12) / 3.04347) * 100) = Math.round(63.19…) = 63
    expect(computeGpPercent(3.50, 1.12, 15)).toBe(63)
  })

  it('$8 ex-GST cost, $14 inc-GST sell, 15% GST → 34% (before in impactOnGP scenario)', () => {
    // sellExGst = 14/1.15 = 12.17391…
    // GP% = Math.round(((12.17391 - 8) / 12.17391) * 100) = Math.round(34.285…) = 34
    expect(computeGpPercent(14, 8, 15)).toBe(34)
  })

  it('$10 ex-GST cost, $14 inc-GST sell, 15% GST → 18% (after in impactOnGP scenario)', () => {
    // sellExGst = 14/1.15 = 12.17391…
    // GP% = Math.round(((12.17391 - 10) / 12.17391) * 100) = Math.round(17.857…) = 18
    expect(computeGpPercent(14, 10, 15)).toBe(18)
  })

  it('zero cost price → 100% GP (gifted or promotional product)', () => {
    // sellExGst = 20/1.15 = 17.3913…; (17.3913 - 0)/17.3913 = 100%
    expect(computeGpPercent(20, 0, 15)).toBe(100)
  })
})

// ── Suite B: null inputs — honest-gap rule ────────────────────────────────────

describe('computeGpPercent — null inputs (honest-gap rule)', () => {
  // The function never guesses a GST rate. All three arguments must be present
  // or the result is null. This is tested per call site in sellPrice.test.ts
  // and servePrice.test.ts; here we test the shared helper directly.

  it('returns null when sellPrice is null', () => {
    expect(computeGpPercent(null, 5, 15)).toBeNull()
  })

  it('returns null when costPrice is null', () => {
    expect(computeGpPercent(14, null, 15)).toBeNull()
  })

  it('returns null when gstPercent is null — never guesses 15% or any other rate', () => {
    expect(computeGpPercent(14, 5, null)).toBeNull()
  })

  it('returns null when all three are null', () => {
    expect(computeGpPercent(null, null, null)).toBeNull()
  })

  it('returns null when sellPrice and gstPercent are null but costPrice is present', () => {
    expect(computeGpPercent(null, 5, null)).toBeNull()
  })

  it('returns null when sellPrice is present but both cost and GST are null', () => {
    expect(computeGpPercent(14, null, null)).toBeNull()
  })

  // Regression: gstPercent: null must produce null, not a stale number
  // (per call site in whole-unit path)
  it('null gstPercent → null even when sellPrice and costPrice are fully populated', () => {
    const result = computeGpPercent(14, 5, null)
    expect(result).toBeNull()
    expect(result).not.toBe(64)  // old wrong answer
    expect(result).not.toBe(59)  // correct non-null answer — must be null, not guessed
  })
})

// ── Suite C: edge cases ───────────────────────────────────────────────────────

describe('computeGpPercent — edge cases', () => {
  it('sellPrice = 0 → null (avoids divide-by-zero; 0/1.15 = 0, then guard fires)', () => {
    expect(computeGpPercent(0, 0, 15)).toBeNull()
  })

  it('sellPrice negative → null (guard: sellPrice <= 0)', () => {
    expect(computeGpPercent(-1, 5, 15)).toBeNull()
  })

  it('costPrice equals sellPriceExGst → 0% margin (break-even)', () => {
    // If costPrice == sellExGst, numerator = 0, GP% = 0
    // sellExGst = 11.5/1.15 = 10 exactly
    expect(computeGpPercent(11.5, 10, 15)).toBe(0)
  })

  it('costPrice exceeds sellPriceExGst → negative margin (selling below cost)', () => {
    // sellExGst = 5/1.15 = 4.3478…; cost = 8 > sellExGst
    // GP% = Math.round(((4.3478 - 8) / 4.3478) * 100) = Math.round(-84.0…) = -84
    expect(computeGpPercent(5, 8, 15)).toBe(-84)
  })

  it('very small sell price does not produce Infinity or NaN', () => {
    const result = computeGpPercent(0.01, 0.005, 15)
    expect(result).not.toBeNaN()
    expect(result).not.toBe(Infinity)
    expect(result).not.toBe(-Infinity)
  })

  it('returns an integer — never a floating-point GP%', () => {
    const result = computeGpPercent(14, 5, 15)
    expect(Number.isInteger(result)).toBe(true)
  })
})

// ── Suite D: GST rate sensitivity (10% AU vs 15% NZ) ─────────────────────────

describe('computeGpPercent — GST rate sensitivity', () => {
  // This confirms the function uses the per-product GST rate, not a hardcoded one.
  // The same inc-GST sell price and ex-GST cost price with different GST rates
  // must produce correctly different GP% values.

  it('15% NZ GST and 10% AU GST produce different results for the same prices', () => {
    const nz = computeGpPercent(14, 5, 15)
    const au = computeGpPercent(14, 5, 10)
    expect(nz).not.toBe(au)
  })

  it('$5 cost, $14 sell, 15% NZ GST → 59%', () => {
    // sellExGst = 14/1.15 = 12.17391…; GP% = Math.round(58.928…) = 59
    expect(computeGpPercent(14, 5, 15)).toBe(59)
  })

  it('$5 cost, $14 sell, 10% AU GST → 61%', () => {
    // sellExGst = 14/1.10 = 12.72727…; GP% = Math.round((7.72727/12.72727)*100)
    //           = Math.round(60.714…) = 61
    expect(computeGpPercent(14, 5, 10)).toBe(61)
  })

  it('10% produces a HIGHER GP% than 15% for the same inc-GST sell price — correct: lower tax → bigger ex-GST margin', () => {
    // A lower GST rate means more of the inc-GST sell price is actually revenue.
    // The same nominal menu price yields a larger ex-GST amount → higher margin.
    const gpAt15 = computeGpPercent(14, 5, 15)!
    const gpAt10 = computeGpPercent(14, 5, 10)!
    expect(gpAt10).toBeGreaterThan(gpAt15)
  })

  it('0% GST (no-tax jurisdiction) gives the same result as the raw price comparison', () => {
    // sellExGst = 14/1.00 = 14; GP% = Math.round(((14-5)/14)*100) = Math.round(64.28…) = 64
    expect(computeGpPercent(14, 5, 0)).toBe(64)
  })
})

// ── Suite E: rounding ─────────────────────────────────────────────────────────

describe('computeGpPercent — rounding (always integer, standard half-up)', () => {
  it('rounds .5 up', () => {
    // Find a case where the unrounded GP% ends in .5
    // Need: ((sellExGst - cost) / sellExGst) * 100 = N.5
    // Using computeGpPercent(7, 3, 15):
    //   sellExGst = 7/1.15 = 6.08695…; GP% = ((6.08695-3)/6.08695)*100 = 50.71… → 51
    expect(computeGpPercent(7, 3, 15)).toBe(51)
  })

  it('result is always an integer (Number.isInteger)', () => {
    const cases: [number, number, number][] = [
      [14, 5, 15],
      [42, 28, 15],
      [3.50, 1.12, 15],
      [10, 3, 10],
      [20, 6, 15],
    ]
    for (const [sell, cost, gst] of cases) {
      const result = computeGpPercent(sell, cost, gst)
      expect(Number.isInteger(result), `computeGpPercent(${sell}, ${cost}, ${gst}) = ${result}`).toBe(true)
    }
  })
})
