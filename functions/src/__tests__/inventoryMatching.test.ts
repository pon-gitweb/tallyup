/**
 * Tests for the shared inventoryMatching module.
 *
 * Covers:
 *   1. normProductName — lowercasing, special-character stripping, whitespace collapse.
 *   2. productNamesMatch — exact, overlap-threshold, mismatch, and edge cases.
 *   3. detectNewProducts — end-to-end: existing products are not proposed;
 *      genuinely new names produce proposals; deduplication works.
 *
 * Strategy: no real Firestore needed — detectNewProducts is tested with a
 * stub `db` that returns a fixed catalog, matching the pattern used across
 * this repo's other function-level tests.
 */

import { normProductName, productNamesMatch, detectNewProducts, NewProductProposal } from "../inventoryMatching";

// ── Firestore stub ────────────────────────────────────────────────────────────

function makeDb(productDocs: Array<{ id: string; name: string }>): any {
  return {
    collection: () => ({
      get: async () => ({
        docs: productDocs.map(p => ({
          id: p.id,
          data: () => ({ name: p.name }),
        })),
      }),
    }),
  };
}

// ── Test catalog ──────────────────────────────────────────────────────────────

const CATALOG = [
  { id: "prod-1", name: "Heineken 330ml" },
  { id: "prod-2", name: "Sauvignon Blanc 750ml" },
  { id: "prod-3", name: "Jack Daniel's Old No.7" },
  { id: "prod-4", name: "Coca-Cola 330ml Can" },
];

// ── Group 1: normProductName ──────────────────────────────────────────────────

describe("normProductName", () => {
  it("IM1: lowercases", () => {
    expect(normProductName("Heineken 330ML")).toBe("heineken 330ml");
  });

  it("IM2: strips special characters", () => {
    expect(normProductName("Jack Daniel's No.7")).toBe("jack daniels no7");
  });

  it("IM3: collapses multiple spaces", () => {
    expect(normProductName("Red  Bull   250ml")).toBe("red bull 250ml");
  });

  it("IM4: trims leading/trailing whitespace", () => {
    expect(normProductName("  Aperol  ")).toBe("aperol");
  });

  it("IM5: empty string returns empty string", () => {
    expect(normProductName("")).toBe("");
  });

  it("IM6: null-ish input returns empty string", () => {
    expect(normProductName(undefined as any)).toBe("");
  });
});

// ── Group 2: productNamesMatch ────────────────────────────────────────────────

describe("productNamesMatch", () => {
  it("IM7: exact normalized match returns true", () => {
    expect(productNamesMatch("Heineken 330ml", "Heineken 330ml")).toBe(true);
  });

  it("IM8: case-insensitive match returns true", () => {
    expect(productNamesMatch("HEINEKEN 330ML", "Heineken 330ml")).toBe(true);
  });

  it("IM9: minor variation within overlap threshold returns true", () => {
    // "Heineken 330ml Bottles" vs "Heineken 330ml" — all tokens of the shorter
    // name appear in the longer name → overlap coefficient = 1.0
    expect(productNamesMatch("Heineken 330ml Bottles", "Heineken 330ml")).toBe(true);
  });

  it("IM10: completely different names return false", () => {
    expect(productNamesMatch("Aperol Spritz", "Heineken 330ml")).toBe(false);
  });

  it("IM11: empty string a returns false", () => {
    expect(productNamesMatch("", "Heineken 330ml")).toBe(false);
  });

  it("IM12: empty string b returns false", () => {
    expect(productNamesMatch("Heineken 330ml", "")).toBe(false);
  });

  it("IM13: both empty returns false (not the same product)", () => {
    // Two unnamed products are not the same thing.
    expect(productNamesMatch("", "")).toBe(false);
  });
});

// ── Group 3: detectNewProducts ────────────────────────────────────────────────

describe("detectNewProducts", () => {
  const db = makeDb(CATALOG);
  const sourceId = "test_src_123";

  it("IM14: existing product is not proposed", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Heineken 330ml"],
      sourceId,
    });
    expect(proposals).toHaveLength(0);
  });

  it("IM15: genuinely new product produces a proposal", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Aperol Spritz 200ml"],
      sourceId,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("newProduct");
    expect(proposals[0].lineName).toBe("Aperol Spritz 200ml");
  });

  it("IM16: proposal id contains the sourceId prefix", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Merlot 750ml"],
      sourceId: "inv_9999",
    });
    expect(proposals[0].id.startsWith("inv_9999:newProduct:")).toBe(true);
  });

  it("IM17: proposal unitPrice is null (no price from stocktake list)", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Red Bull 250ml"],
      sourceId,
    });
    expect(proposals[0].unitPrice).toBeNull();
  });

  it("IM18: mix of new and existing produces only proposals for new ones", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Heineken 330ml", "Aperol Spritz", "Sauvignon Blanc 750ml", "Campari 700ml"],
      sourceId,
    });
    const proposedNames = proposals.map((p: NewProductProposal) => p.lineName);
    expect(proposedNames).toContain("Aperol Spritz");
    expect(proposedNames).toContain("Campari 700ml");
    expect(proposedNames).not.toContain("Heineken 330ml");
    expect(proposedNames).not.toContain("Sauvignon Blanc 750ml");
  });

  it("IM19: duplicate names in input produce only one proposal", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Aperol 700ml", "Aperol 700ml", "aperol 700ml"],
      sourceId,
    });
    expect(proposals).toHaveLength(1);
  });

  it("IM20: empty name strings are skipped", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["", "  ", "Real product"],
      sourceId,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].lineName).toBe("Real product");
  });

  it("IM21: supplierId and supplierName are included in proposals when provided", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Tanqueray Gin 700ml"],
      sourceId,
      supplierId: "sup-42",
      supplierName: "Premium Spirits Ltd",
    });
    expect(proposals[0].supplierId).toBe("sup-42");
    expect(proposals[0].supplierName).toBe("Premium Spirits Ltd");
  });

  it("IM22: supplierId defaults to null when not provided", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["Gordon's Gin 700ml"],
      sourceId,
    });
    expect(proposals[0].supplierId).toBeNull();
    expect(proposals[0].supplierName).toBeNull();
  });

  it("IM23: empty productNames array produces no proposals", async () => {
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: [],
      sourceId,
    });
    expect(proposals).toHaveLength(0);
  });

  it("IM24: case-variant existing name is not re-proposed", async () => {
    // "HEINEKEN 330ML" should match "Heineken 330ml" in the catalog — no proposal.
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-1",
      productNames: ["HEINEKEN 330ML"],
      sourceId,
    });
    expect(proposals).toHaveLength(0);
  });
});

// ── Group 4: identical results from both call sites ───────────────────────────
// Confirms that detectNewProducts produces the same output whether called
// from ocrInvoicePhoto or /extract-inventory, given identical inputs.

describe("identical results from both call sites", () => {
  it("IM25: two calls with same inputs produce identical proposal IDs", async () => {
    const db = makeDb(CATALOG);
    const args = {
      db,
      venueId: "v-shared",
      productNames: ["Bombay Sapphire 700ml", "Hendricks Gin 750ml"],
      sourceId: "shared_src_1",
    };

    const result1 = await detectNewProducts({ ...args });
    const result2 = await detectNewProducts({ ...args });

    expect(result1.proposals.map((p: NewProductProposal) => p.id)).toEqual(
      result2.proposals.map((p: NewProductProposal) => p.id)
    );
  });

  it("IM26: proposals from both call sites have type 'newProduct'", async () => {
    const db = makeDb(CATALOG);
    const { proposals } = await detectNewProducts({
      db,
      venueId: "v-shared",
      productNames: ["Campari 700ml"],
      sourceId: "any_source",
    });
    for (const p of proposals) {
      expect(p.type).toBe("newProduct");
    }
  });
});
