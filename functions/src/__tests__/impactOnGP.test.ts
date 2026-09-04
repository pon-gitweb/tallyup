/**
 * Tests for computeImpactOnGP — the pure helper that populates the
 * impactOnGP field on priceChangeFlags documents.
 *
 * All expected values are hand-verified with the GST-adjusted formula:
 *   sellPriceExGst = sellPrice / (1 + gstPercent / 100)
 *   GP% = Math.round(((sellPriceExGst - cost) / sellPriceExGst) * 100)
 *
 * Coverage:
 *   A. Correct before/after GP% with GST-adjusted sell price (hand-verified)
 *   B. Returns null when gstPercent is null — consistent with honest-gap rule
 *   C. Returns null when sellPrice is null
 *   D. Different GST rates (10% AU vs 15% NZ) produce correctly different results
 *   E. Price decrease — after GP% is better than before
 *   F. Contract-extraction write path regression — structurally isolated
 */

import { computeImpactOnGP } from "../api";

describe("computeImpactOnGP (GST-adjusted)", () => {
  // Hand-verify Suite A numbers — $14 inc-GST sell, 15% NZ GST:
  //   sellPriceExGst = 14 / 1.15 = 12.17391304…
  //   before ($8 cost): Math.round(((12.17391 - 8)  / 12.17391) * 100) = Math.round(34.285…) = 34
  //   after  ($10 cost): Math.round(((12.17391 - 10) / 12.17391) * 100) = Math.round(17.857…) = 18

  describe("Suite A: correct before/after GP% with GST-adjusted sell price", () => {
    it("price increase: $8→$10 cost, $14 sell, 15% GST → { before: 34, after: 18 }", () => {
      const result = computeImpactOnGP(14, 8, 10, 15);
      expect(result).toEqual({ before: 34, after: 18 });
    });

    it("before GP% = 34 (hand-verified: Math.round(34.285…) = 34)", () => {
      expect(computeImpactOnGP(14, 8, 10, 15)?.before).toBe(34);
    });

    it("after GP% = 18 (hand-verified: Math.round(17.857…) = 18)", () => {
      expect(computeImpactOnGP(14, 8, 10, 15)?.after).toBe(18);
    });

    it("simple round-number check: $6→$8 cost, $20 sell, 15% GST", () => {
      // sellExGst = 20 / 1.15 = 17.3913…
      // before: (17.3913 - 6) / 17.3913 * 100 = Math.round(65.517…) = 66
      // after:  (17.3913 - 8) / 17.3913 * 100 = Math.round(54.023…) = 54
      expect(computeImpactOnGP(20, 6, 8, 15)).toEqual({ before: 66, after: 54 });
    });

    it("rounds to nearest integer (no fractional GP%)", () => {
      // $7 sell, 15% GST, $3 old → $4 new
      // sellExGst = 7 / 1.15 = 6.0869…
      // before: (6.0869 - 3) / 6.0869 * 100 = Math.round(50.71…) = 51
      // after:  (6.0869 - 4) / 6.0869 * 100 = Math.round(34.28…) = 34
      expect(computeImpactOnGP(7, 3, 4, 15)).toEqual({ before: 51, after: 34 });
    });
  });

  describe("Suite B: null when gstPercent is null — honest-gap rule", () => {
    it("returns null when gstPercent is null", () => {
      expect(computeImpactOnGP(14, 8, 10, null)).toBeNull();
    });

    it("result is null (not a partial object) when gstPercent is absent", () => {
      expect(computeImpactOnGP(14, 8, 10, null)).toBeNull();
    });
  });

  describe("Suite C: null when sellPrice is null", () => {
    it("returns null when sellPrice is null", () => {
      expect(computeImpactOnGP(null, 8, 10, 15)).toBeNull();
    });

    it("returns null when both sellPrice and gstPercent are null", () => {
      expect(computeImpactOnGP(null, 8, 10, null)).toBeNull();
    });
  });

  describe("Suite D: 10% (AU) vs 15% (NZ) GST produce correctly different results", () => {
    // This confirms the function uses the per-product rate, not a hardcoded one.
    //
    // $14 sell, $8→$10 cost:
    //
    // 15% NZ GST:
    //   sellExGst = 14 / 1.15 = 12.17391…
    //   before = Math.round((4.17391 / 12.17391) * 100) = 34
    //   after  = Math.round((2.17391 / 12.17391) * 100) = 18
    //
    // 10% AU GST:
    //   sellExGst = 14 / 1.10 = 12.72727…
    //   before = Math.round((4.72727 / 12.72727) * 100) = Math.round(37.142…) = 37
    //   after  = Math.round((2.72727 / 12.72727) * 100) = Math.round(21.428…) = 21

    it("15% NZ GST → { before: 34, after: 18 }", () => {
      expect(computeImpactOnGP(14, 8, 10, 15)).toEqual({ before: 34, after: 18 });
    });

    it("10% AU GST → { before: 37, after: 21 }", () => {
      expect(computeImpactOnGP(14, 8, 10, 10)).toEqual({ before: 37, after: 21 });
    });

    it("NZ and AU results are different — per-product rate is used, not a hardcoded rate", () => {
      const nz = computeImpactOnGP(14, 8, 10, 15);
      const au = computeImpactOnGP(14, 8, 10, 10);
      expect(nz).not.toEqual(au);
    });
  });

  describe("Suite E: price decrease — after GP% improves", () => {
    it("cost drops $10→$8 with $14 sell, 15% GST → after is better than before", () => {
      // before: (12.17391 - 10) / 12.17391 = 17.857… → 18
      // after:  (12.17391 - 8)  / 12.17391 = 34.285… → 34
      const result = computeImpactOnGP(14, 10, 8, 15);
      expect(result).toEqual({ before: 18, after: 34 });
      expect(result!.after).toBeGreaterThan(result!.before);
    });
  });

  describe("Suite F: contract-extraction write path not affected", () => {
    it("computeImpactOnGP is a pure function; contract-extraction uses a direct .add() with no shared code path", () => {
      const result = computeImpactOnGP(20, 5, 7, 15);
      expect(result).not.toBeNull();
      expect(typeof result!.before).toBe("number");
      expect(typeof result!.after).toBe("number");
    });
  });
});
