/**
 * Tests for the Stage-3 Suitee tool: get_supplier_compliance.
 *
 * aggregateSupplierCompliance(records, topN, windowDays) → SupplierComplianceResult
 *   Pure aggregation: groups invoiceHistory records by productId, counts preferred
 *   vs non-preferred purchases, computes dollar impact using the most-recent
 *   preferred-supplier price as the benchmark. Sorted by estimatedExtraCost
 *   descending (null entries trail all real figures).
 *
 * Hand-verification of fixtures
 * ─────────────────────────────
 * Product A ("House Gin", prd-a):
 *   preferred:     unitCost=40, qty=2, dateMs=1000  ← most-recent preferred → benchmark=40
 *   non-preferred: unitCost=50, qty=1, dateMs=2000
 *   extraCost = (50−40) × 1 = $10.00
 *   nonPreferredPurchases = 1, totalPurchases = 2
 *
 * Product B ("House Vodka", prd-b):
 *   preferred:       unitCost=35, qty=1, dateMs=1000  ← benchmark=35
 *   non-preferred 1: unitCost=45, qty=2, dateMs=2000  → (45−35)×2 = $20
 *   non-preferred 2: unitCost=38, qty=3, dateMs=3000  → (38−35)×3 = $9
 *   extraCost = $20 + $9 = $29.00
 *   nonPreferredPurchases = 2, totalPurchases = 3
 *
 * Product C ("House Rum", prd-c):
 *   non-preferred only: unitCost=55, qty=1, dateMs=1000
 *   No preferred entry in window → estimatedExtraCost = null
 *   nonPreferredPurchases = 1, totalPurchases = 1
 *
 * Product D ("House Tequila", prd-d):
 *   All preferred: wasPreferredSupplier=true → excluded from output
 *
 * Sorted descending: B($29), A($10), C(null)
 */

import {
  aggregateSupplierCompliance,
  InvoiceHistoryRecord,
} from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECORDS: InvoiceHistoryRecord[] = [
  // Product A — House Gin
  { productId: 'prd-a', productName: 'House Gin',     unitCost: 40, qty: 2, wasPreferredSupplier: true,  dateMs: 1000 },
  { productId: 'prd-a', productName: 'House Gin',     unitCost: 50, qty: 1, wasPreferredSupplier: false, dateMs: 2000 },
  // Product B — House Vodka (two non-preferred entries)
  { productId: 'prd-b', productName: 'House Vodka',   unitCost: 35, qty: 1, wasPreferredSupplier: true,  dateMs: 1000 },
  { productId: 'prd-b', productName: 'House Vodka',   unitCost: 45, qty: 2, wasPreferredSupplier: false, dateMs: 2000 },
  { productId: 'prd-b', productName: 'House Vodka',   unitCost: 38, qty: 3, wasPreferredSupplier: false, dateMs: 3000 },
  // Product C — House Rum (non-preferred only, no preferred baseline)
  { productId: 'prd-c', productName: 'House Rum',     unitCost: 55, qty: 1, wasPreferredSupplier: false, dateMs: 1000 },
  // Product D — House Tequila (all preferred — should be excluded)
  { productId: 'prd-d', productName: 'House Tequila', unitCost: 60, qty: 1, wasPreferredSupplier: true,  dateMs: 1000 },
];

// ── Suite A: aggregateSupplierCompliance — core correctness ───────────────────

describe('aggregateSupplierCompliance — core correctness', () => {

  it('A1: hand-verified order and dollar amounts — B($29), A($10), C(null)', () => {
    const result = aggregateSupplierCompliance(RECORDS, 10, 90);

    expect(result.hasData).toBe(true);
    expect(result.windowDays).toBe(90);
    expect(result.products).toHaveLength(3); // D excluded; C included with null cost

    const [b, a, c] = result.products;

    // Product B — $29 extra cost
    expect(b.productName).toBe('House Vodka');
    expect(b.totalPurchases).toBe(3);
    expect(b.nonPreferredPurchases).toBe(2);
    expect(b.estimatedExtraCost).toBe(29);    // (45−35)×2 + (38−35)×3 = 20 + 9

    // Product A — $10 extra cost
    expect(a.productName).toBe('House Gin');
    expect(a.totalPurchases).toBe(2);
    expect(a.nonPreferredPurchases).toBe(1);
    expect(a.estimatedExtraCost).toBe(10);    // (50−40)×1

    // Product C — no preferred baseline, estimatedExtraCost is null
    expect(c.productName).toBe('House Rum');
    expect(c.nonPreferredPurchases).toBe(1);
    expect(c.estimatedExtraCost).toBeNull();
  });

  it('A2: product with 100% preferred-supplier compliance is excluded', () => {
    const result = aggregateSupplierCompliance(RECORDS, 10, 90);
    expect(result.products.find(p => p.productName === 'House Tequila')).toBeUndefined();
  });

  it('A3: non-preferred purchase with no preferred baseline → counted in nonPreferredPurchases, estimatedExtraCost null', () => {
    const result = aggregateSupplierCompliance(RECORDS, 10, 90);
    const c = result.products.find(p => p.productName === 'House Rum');
    expect(c).toBeDefined();
    expect(c!.nonPreferredPurchases).toBe(1);
    expect(c!.estimatedExtraCost).toBeNull();
  });

  it('A4: most-recent preferred price used as benchmark (not oldest, not average)', () => {
    // Product with two preferred entries at different prices — benchmark must be the latest.
    const records: InvoiceHistoryRecord[] = [
      // Older preferred entry at $30 — must NOT be used as benchmark
      { productId: 'p1', productName: 'Test Spirit', unitCost: 30, qty: 1, wasPreferredSupplier: true,  dateMs: 1000 },
      // Newer preferred entry at $40 — THIS is the benchmark
      { productId: 'p1', productName: 'Test Spirit', unitCost: 40, qty: 1, wasPreferredSupplier: true,  dateMs: 3000 },
      // Non-preferred at $45: extra = (45−40)×1 = $5 (not $15, which would use the $30 benchmark)
      { productId: 'p1', productName: 'Test Spirit', unitCost: 45, qty: 1, wasPreferredSupplier: false, dateMs: 2000 },
    ];
    const result = aggregateSupplierCompliance(records, 5, 90);
    expect(result.products[0].estimatedExtraCost).toBe(5); // (45−40)×1, not (45−30)×1
  });

  it('A5: non-preferred unitCost below preferred benchmark → contributes $0 to estimatedExtraCost', () => {
    // Non-preferred supplier was actually cheaper — no extra cost for this entry.
    const records: InvoiceHistoryRecord[] = [
      { productId: 'p1', productName: 'Cheap Wine', unitCost: 20, qty: 1, wasPreferredSupplier: true,  dateMs: 1000 },
      { productId: 'p1', productName: 'Cheap Wine', unitCost: 15, qty: 2, wasPreferredSupplier: false, dateMs: 2000 }, // cheaper!
    ];
    const result = aggregateSupplierCompliance(records, 5, 90);
    expect(result.products[0].nonPreferredPurchases).toBe(1);
    expect(result.products[0].estimatedExtraCost).toBe(0); // diff=15−20=−5, clamped to 0
  });

  it('A6: dollar sorting — real dollar entries before null; descending within real entries', () => {
    const result = aggregateSupplierCompliance(RECORDS, 10, 90);
    const costs = result.products.map(p => p.estimatedExtraCost);
    // Real values come before nulls
    const lastNonNull = costs.reduce((idx, v, i) => v !== null ? i : idx, -1);
    const firstNull   = costs.findIndex(v => v === null);
    if (firstNull !== -1) expect(lastNonNull).toBeLessThan(firstNull);
    // Real values are descending
    const reals = costs.filter((v): v is number => v !== null);
    for (let i = 1; i < reals.length; i++) expect(reals[i]).toBeLessThanOrEqual(reals[i - 1]);
  });

  it('A7: topN cap — 3 non-compliant products, topN=2 returns the 2 most costly', () => {
    const result = aggregateSupplierCompliance(RECORDS, 2, 90);
    expect(result.products).toHaveLength(2);
    // Top 2 by cost: B($29), A($10)
    expect(result.products[0].productName).toBe('House Vodka');
    expect(result.products[1].productName).toBe('House Gin');
  });

  it('A8: empty records → hasData:false', () => {
    const result = aggregateSupplierCompliance([], 5, 90);
    expect(result.hasData).toBe(false);
    expect(result.products).toHaveLength(0);
  });

  it('A9: all records are preferred → hasData:false (nothing to flag)', () => {
    const allPreferred: InvoiceHistoryRecord[] = [
      { productId: 'p1', productName: 'Wine', unitCost: 20, qty: 1, wasPreferredSupplier: true, dateMs: 1000 },
      { productId: 'p2', productName: 'Beer', unitCost: 5,  qty: 6, wasPreferredSupplier: true, dateMs: 1000 },
    ];
    const result = aggregateSupplierCompliance(allPreferred, 5, 90);
    expect(result.hasData).toBe(false);
  });

  it('A10: windowDays is echoed back into the result', () => {
    const result = aggregateSupplierCompliance(RECORDS, 5, 30);
    expect(result.windowDays).toBe(30);
  });

  it('A11: estimatedExtraCost rounds to 2 decimal places', () => {
    // Extra cost: (10.005 − 10) × 1 = 0.005 → rounds to $0.01
    const records: InvoiceHistoryRecord[] = [
      { productId: 'p1', productName: 'Rounding Test', unitCost: 10,    qty: 1, wasPreferredSupplier: true,  dateMs: 1000 },
      { productId: 'p1', productName: 'Rounding Test', unitCost: 10.015, qty: 2, wasPreferredSupplier: false, dateMs: 2000 },
    ];
    // extra = (10.015 − 10) × 2 = 0.015 × 2 = 0.03 → Math.round(0.03 * 100)/100 = 0.03
    const result = aggregateSupplierCompliance(records, 5, 90);
    expect(result.products[0].estimatedExtraCost).toBe(0.03);
  });
});
