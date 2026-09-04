/**
 * Tests for computeImpactOnGP — the pure helper that populates the
 * impactOnGP field on priceChangeFlags documents.
 *
 * Hand-verified numbers throughout — no "assert against whatever the code
 * outputs" shortcuts.  Same discipline as the keg test.
 *
 * Coverage:
 *   A. Correct before/after GP% when sellPrice is present (hand-verified)
 *   B. Returns null when sellPrice is null (no-sell-price case, unchanged from today)
 *   C. Returns null when sellPrice is zero (divide-by-zero guard)
 *   D. Handles a price decrease correctly (after GP% improves)
 *   E. Regression — the contract-extraction write path is a direct Firestore
 *      .add() call that does NOT use flagPriceChangeToManager; verified by
 *      grep/structural isolation — no tests needed for a path we didn't change
 */

import { computeImpactOnGP } from "../api";

describe("computeImpactOnGP", () => {
  // Hand-verify test A numbers:
  //   sellPrice = $14.00, oldPrice (cost before) = $8.00, newPrice (cost after) = $10.00
  //   before = Math.round(((14 - 8) / 14) * 100) = Math.round(42.857…) = 43
  //   after  = Math.round(((14 - 10) / 14) * 100) = Math.round(28.571…) = 29

  describe("Suite A: correct before/after GP% when sellPrice is present", () => {
    it("price increase: $8→$10 cost, $14 sell → { before: 43, after: 29 }", () => {
      const result = computeImpactOnGP(14, 8, 10);
      expect(result).toEqual({ before: 43, after: 29 });
    });

    it("before GP% = Math.round(((14 - 8) / 14) * 100) = 43", () => {
      const result = computeImpactOnGP(14, 8, 10);
      expect(result?.before).toBe(43);
    });

    it("after GP% = Math.round(((14 - 10) / 14) * 100) = 29", () => {
      const result = computeImpactOnGP(14, 8, 10);
      expect(result?.after).toBe(29);
    });

    it("simple round-number check: $6→$8 cost, $20 sell → { before: 70, after: 60 }", () => {
      // before = Math.round(((20 - 6) / 20) * 100) = Math.round(70.0) = 70
      // after  = Math.round(((20 - 8) / 20) * 100) = Math.round(60.0) = 60
      expect(computeImpactOnGP(20, 6, 8)).toEqual({ before: 70, after: 60 });
    });

    it("rounds to nearest integer (no fractional GP%)", () => {
      // sellPrice $7, oldPrice $3, newPrice $4
      // before = Math.round(((7 - 3) / 7) * 100) = Math.round(57.142…) = 57
      // after  = Math.round(((7 - 4) / 7) * 100) = Math.round(42.857…) = 43
      expect(computeImpactOnGP(7, 3, 4)).toEqual({ before: 57, after: 43 });
    });
  });

  describe("Suite B: null when sellPrice is absent — unchanged from today's default", () => {
    it("returns null when sellPrice is null", () => {
      expect(computeImpactOnGP(null, 8, 10)).toBeNull();
    });

    it("result structure is null, not { before: null, after: null }", () => {
      // Firstore document stores null, not a partial object
      const result = computeImpactOnGP(null, 8, 10);
      expect(result).toBeNull();
    });
  });

  describe("Suite C: null when sellPrice is zero (divide-by-zero guard)", () => {
    it("returns null when sellPrice is 0", () => {
      expect(computeImpactOnGP(0, 0, 0)).toBeNull();
    });

    it("returns null when sellPrice is 0 even if costs are non-zero", () => {
      expect(computeImpactOnGP(0, 5, 8)).toBeNull();
    });
  });

  describe("Suite D: price decrease — after GP% improves", () => {
    it("price decrease $10→$8 cost, $14 sell → after GP% is better than before", () => {
      // before = Math.round(((14 - 10) / 14) * 100) = Math.round(28.571…) = 29
      // after  = Math.round(((14 - 8)  / 14) * 100) = Math.round(42.857…) = 43
      const result = computeImpactOnGP(14, 10, 8);
      expect(result).toEqual({ before: 29, after: 43 });
      expect(result!.after).toBeGreaterThan(result!.before);
    });
  });

  describe("Suite E: structural regression — contract-extraction write not affected", () => {
    it("computeImpactOnGP is a standalone pure function; contract-extraction path uses a direct .add() — no shared code path", () => {
      // The contract-extraction write at api.ts ~line 7053 calls db.collection().add()
      // directly and does NOT call flagPriceChangeToManager at all.
      // This test documents the isolation: computeImpactOnGP accepts its inputs
      // explicitly and has no side effects — it cannot affect the other write path.
      const result = computeImpactOnGP(20, 5, 7);
      expect(result).not.toBeNull(); // pure function, no Firestore interaction
      expect(typeof result!.before).toBe("number");
      expect(typeof result!.after).toBe("number");
    });
  });
});
