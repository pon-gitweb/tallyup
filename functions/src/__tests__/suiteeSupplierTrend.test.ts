/**
 * Tests for the Stage-1 Suitee tool: get_supplier_price_trend.
 *
 * aggregateSupplierTrend(records, topN, windowDays) → SupplierTrendResult
 *   Pure aggregation: groups priceChangeFlags records by supplierId (with graceful
 *   name-based fallback for ID-less legacy records), computes avgChangePercent per
 *   supplier, sorts descending, caps at topN.
 *
 * runToolLoop async resolver upgrade
 *   The Stage-0 loop is extended to accept async resolveToolCall functions.
 *   Existing sync-resolver tests in suiteeGpTool.test.ts remain unaffected (regression).
 *
 * Fixtures and hand-verification
 * ──────────────────────────────
 * Supplier A ("Allied Beverages", supplierId "sup-a"):
 *   ID-tagged: changePercent 10, 20
 *   Name-only: changePercent 15  ← must merge via name→id lookup, NOT split into a phantom
 *   avg = (10 + 20 + 15) / 3 = 45 / 3 = 15.0   changeCount = 3   direction = 'up'
 *
 * Supplier B ("Premium Spirits", supplierId "sup-b"):
 *   ID-tagged: changePercent -5, -10
 *   avg = (-5 + -10) / 2 = -15 / 2 = -7.5       changeCount = 2   direction = 'down'
 *
 * Supplier C ("Solo Wines", no supplierId, no matching ID-tagged record):
 *   Name-only: changePercent 50
 *   avg = 50 / 1 = 50.0                          changeCount = 1   direction = 'up'
 *
 * Sorted descending: C(50), A(15), B(-7.5)
 */

import {
  aggregateSupplierTrend,
  runToolLoop,
  PriceChangeRecord,
} from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_RECORDS: PriceChangeRecord[] = [
  // Supplier A — two ID-tagged records
  { supplierId: 'sup-a', supplierName: 'Allied Beverages', changePercent: 10 },
  { supplierId: 'sup-a', supplierName: 'Allied Beverages', changePercent: 20 },
  // Supplier A — one name-only record (older, no supplierId) — must merge with sup-a
  { supplierId: null,     supplierName: 'Allied Beverages', changePercent: 15 },
  // Supplier B — two ID-tagged, both decreases
  { supplierId: 'sup-b', supplierName: 'Premium Spirits',  changePercent: -5 },
  { supplierId: 'sup-b', supplierName: 'Premium Spirits',  changePercent: -10 },
  // Supplier C — name-only, no matching supplierId in this batch
  { supplierId: null,     supplierName: 'Solo Wines',       changePercent: 50 },
];

// ── Suite A: aggregateSupplierTrend — aggregation correctness ─────────────────

describe('aggregateSupplierTrend — aggregation correctness', () => {

  it('A1: hand-verified averages — correct avgChangePercent and direction per supplier', () => {
    const result = aggregateSupplierTrend(BASE_RECORDS, 5, 90);

    expect(result.hasData).toBe(true);
    expect(result.windowDays).toBe(90);

    // Sorted descending: C(50), A(15), B(-7.5)
    const [c, a, b] = result.suppliers;

    // Solo Wines — name-only, orphan group
    expect(c.supplierName).toBe('Solo Wines');
    expect(c.supplierId).toBeNull();
    expect(c.changeCount).toBe(1);
    expect(c.avgChangePercent).toBe(50);
    expect(c.direction).toBe('up');

    // Allied Beverages — merged (3 records including name-only)
    expect(a.supplierId).toBe('sup-a');
    expect(a.supplierName).toBe('Allied Beverages');
    expect(a.changeCount).toBe(3);
    expect(a.avgChangePercent).toBe(15);  // (10+20+15)/3 = 15
    expect(a.direction).toBe('up');

    // Premium Spirits — two decreases
    expect(b.supplierId).toBe('sup-b');
    expect(b.changeCount).toBe(2);
    expect(b.avgChangePercent).toBe(-7.5); // (-5+-10)/2 = -7.5
    expect(b.direction).toBe('down');
  });

  it('A2: supplier with mix of ID-tagged and name-only records is ONE entry, not two', () => {
    // The critical regression: if grouping were by raw name instead of supplierId-first,
    // "Allied Beverages" would split into a name-only group and an ID group — wrong.
    const result = aggregateSupplierTrend(BASE_RECORDS, 10, 90);

    const alliedEntries = result.suppliers.filter(
      s => s.supplierName === 'Allied Beverages',
    );
    expect(alliedEntries).toHaveLength(1);
    expect(alliedEntries[0].changeCount).toBe(3);       // all 3 records merged
    expect(alliedEntries[0].supplierId).toBe('sup-a');  // ID was resolved correctly
  });

  it('A3: empty records → hasData:false, suppliers:[], no fabricated data', () => {
    const result = aggregateSupplierTrend([], 5, 90);
    expect(result.hasData).toBe(false);
    expect(result.suppliers).toHaveLength(0);
    expect(result.windowDays).toBe(90);
  });

  it('A4: topN cap — 6 suppliers in input, only 5 returned', () => {
    const sixSuppliers: PriceChangeRecord[] = [
      { supplierId: 's1', supplierName: 'S1', changePercent: 60 },
      { supplierId: 's2', supplierName: 'S2', changePercent: 50 },
      { supplierId: 's3', supplierName: 'S3', changePercent: 40 },
      { supplierId: 's4', supplierName: 'S4', changePercent: 30 },
      { supplierId: 's5', supplierName: 'S5', changePercent: 20 },
      { supplierId: 's6', supplierName: 'S6', changePercent: 10 }, // cut off
    ];
    const result = aggregateSupplierTrend(sixSuppliers, 5, 90);
    expect(result.suppliers).toHaveLength(5);
    // S6 (lowest avg) should be excluded
    expect(result.suppliers.find(s => s.supplierId === 's6')).toBeUndefined();
    // Top entry should be S1
    expect(result.suppliers[0].supplierId).toBe('s1');
  });

  it('A5: direction field — up/down/flat based on avgChangePercent sign', () => {
    const records: PriceChangeRecord[] = [
      { supplierId: 'pos', supplierName: 'Up Co',   changePercent: 5 },
      { supplierId: 'neg', supplierName: 'Down Co', changePercent: -5 },
      { supplierId: 'zer', supplierName: 'Flat Co', changePercent: 0 },
    ];
    const result = aggregateSupplierTrend(records, 5, 90);
    const byId = Object.fromEntries(result.suppliers.map(s => [s.supplierId, s]));

    expect(byId['pos'].direction).toBe('up');
    expect(byId['neg'].direction).toBe('down');
    expect(byId['zer'].direction).toBe('flat');
  });

  it('A6: windowDays is echoed back into the result', () => {
    const result = aggregateSupplierTrend(BASE_RECORDS, 5, 30);
    expect(result.windowDays).toBe(30);
  });

  it('A7: records with neither supplierId nor supplierName are silently skipped', () => {
    const records: PriceChangeRecord[] = [
      { supplierId: 'sup-x', supplierName: 'Valid Co', changePercent: 10 },
      { supplierId: null, supplierName: null, changePercent: 99 }, // no identity — skip
    ];
    const result = aggregateSupplierTrend(records, 5, 90);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0].supplierId).toBe('sup-x');
  });

  it('A8: avgChangePercent rounds to 2 decimal places', () => {
    // (10 + 20 + 3) / 3 = 33 / 3 = 11.0 exactly — use a case that exercises rounding
    // (7 + 8 + 9) / 3 = 24 / 3 = 8.0 — still exact; use mixed
    // (7 + 8) / 3 = 5.0 — use: 1 + 2 + 3 = 6/3 = 2.0
    // Better: (1 + 2) / 3 = 1.0 — exact
    // Best case that needs rounding: (1 + 1 + 1 + 1 + 1 + 1 + 1) / 3 = 7/3 = 2.333...
    const records: PriceChangeRecord[] = [
      { supplierId: 'r', supplierName: 'Rounding Co', changePercent: 10 },
      { supplierId: 'r', supplierName: 'Rounding Co', changePercent: 10 },
      { supplierId: 'r', supplierName: 'Rounding Co', changePercent: 11 },
    ]; // avg = 31/3 = 10.333... → rounded to 10.33
    const result = aggregateSupplierTrend(records, 5, 90);
    expect(result.suppliers[0].avgChangePercent).toBe(10.33);
  });
});

// ── Suite B: runToolLoop — async resolver support ────────────────────────────
//
// The Stage-0 loop was upgraded from a sync .map() to an async for-loop so that
// resolveToolCall can be async (e.g. a Firestore query for get_supplier_price_trend).
// The existing suiteeGpTool.test.ts tests already cover sync resolvers — these tests
// confirm the async path and serve as the Stage-0 regression gate.

describe('runToolLoop — async resolver support', () => {

  it('B1: async resolveToolCall (returns a Promise) → loop awaits it correctly', async () => {
    const callFn = jest.fn()
      .mockResolvedValueOnce({
        content: [{
          type: 'tool_use',
          id: 'tu-async',
          name: 'get_supplier_price_trend',
          input: { days: 90 },
        }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Allied Beverages increased the most at 15% average.' }],
      });

    // Async resolver — simulates the Firestore-backed get_supplier_price_trend path.
    const asyncResolver = jest.fn().mockResolvedValue({
      hasData: true,
      suppliers: [{ supplierId: 'sup-a', supplierName: 'Allied Beverages', changeCount: 3, avgChangePercent: 15, direction: 'up' }],
      windowDays: 90,
    });

    const result = await runToolLoop(
      callFn,
      [{ role: 'user', content: 'Which supplier has increased prices the most?' }],
      asyncResolver,
    );

    expect(result).toBe('Allied Beverages increased the most at 15% average.');
    expect(callFn).toHaveBeenCalledTimes(2);
    expect(asyncResolver).toHaveBeenCalledWith('get_supplier_price_trend', { days: 90 });
  });

  it('B2: async resolver rejection → structured error in tool_result, loop recovers', async () => {
    const callFn = jest.fn()
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu-rej', name: 'get_supplier_price_trend', input: {} }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Could not retrieve trend data.' }],
      });

    // Resolver returns a rejected promise (e.g. Firestore permission error).
    const rejectingResolver = jest.fn().mockRejectedValue(new Error('Firestore permission denied'));

    const result = await runToolLoop(callFn, [{ role: 'user', content: '...' }], rejectingResolver);

    // Loop recovered — returned the second-round text.
    expect(result).toBe('Could not retrieve trend data.');
    expect(callFn).toHaveBeenCalledTimes(2);

    // The tool_result passed to the second Claude call should contain the error.
    const secondCallMessages = callFn.mock.calls[1][0];
    const toolResultTurn = secondCallMessages.find(
      (m: any) => m.role === 'user' && Array.isArray(m.content),
    );
    expect(toolResultTurn).toBeDefined();
    const parsed = JSON.parse(toolResultTurn.content[0].content);
    expect(parsed.error).toMatch(/Tool execution error/);
    expect(parsed.error).toMatch(/Firestore permission denied/);
  });

  it('B3: Stage-0 regression — sync GP resolver still works after async upgrade', async () => {
    // Confirm that upgrading .map() to for-await did not break Stage-0 sync resolvers.
    const callFn = jest.fn()
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu-sync', name: 'get_gp_analysis', input: { keyword: 'gin' } }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Gin has a 64% GP.' }],
      });

    const syncResolver = jest.fn().mockReturnValue({ found: true, gpPercent: 64 }); // sync

    const result = await runToolLoop(callFn, [{ role: 'user', content: '...' }], syncResolver);

    expect(result).toBe('Gin has a 64% GP.');
    expect(syncResolver).toHaveBeenCalledWith('get_gp_analysis', { keyword: 'gin' });
  });
});
