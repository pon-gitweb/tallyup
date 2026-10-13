/**
 * Tests for buildSalesPerformanceResult (pure aggregation in suiteeTools.ts).
 *
 * All tests use a fixed todayNZ of '2026-10-13' (Tuesday).
 * With that anchor:
 *   currentWeekMon = '2026-10-12'
 *   anchorMon      = '2026-10-05'
 *   last4Mondays   = ['2026-09-14','2026-09-21','2026-09-28','2026-10-05']
 *   prev4Mondays   = ['2026-08-10','2026-08-17','2026-08-24','2026-08-31']
 */

import { buildSalesPerformanceResult } from '../suiteeTools';
import { normaliseSalesReport, matchDocToMatchData } from '../weeklyLedger';
import type { ActiveReport, MatchData, StockEntry } from '../weeklyLedger';

const TODAY_NZ = '2026-10-13';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeReport(
  id: string,
  startStr: string,
  endStr: string,
  opts: {
    status?: string | null;
    hasLineTotals?: boolean;
    qtySold?: number;
  } = {},
): ActiveReport {
  const { status = null, hasLineTotals = true, qtySold = 10 } = opts;
  const startMs = new Date(startStr + 'T00:00:00Z').getTime();
  const endMs   = new Date(endStr   + 'T00:00:00Z').getTime();
  const days    = Math.round((endMs - startMs) / 86_400_000) + 1;
  const gross   = 100 * qtySold;
  return {
    id,
    source: 'bustle',
    startStr,
    endStr,
    startMs,
    days,
    lineCount:    1,
    totalRevenue: gross,
    totalQtySold: qtySold,
    rawLines:     [{ name: `Product ${id}`, qtySold, gross, grossIncl: gross * 1.15, netExcl: hasLineTotals ? gross : undefined }],
    overlappingCycles: [],
    allocationMethod: 'none',
    status,
    meta: hasLineTotals ? { lineTotalsBasis: 'line_total' } : null,
  };
}

function makeMatch(id: string, productId: string, qtySold: number): MatchData {
  return {
    matched:        1,
    total:          1,
    matchedRevenue: qtySold * 100,
    matchedQty:     qtySold,
    matches:        [{ productId, productName: `Prod ${productId}`, name: `Prod ${productId}`, qtySold, gross: qtySold * 100 }],
  };
}

const EMPTY_STOCK: Record<string, StockEntry> = {};

function makeSquareReport(id: string, date: string, qtySold: number): ActiveReport {
  const startMs = new Date(date + 'T00:00:00Z').getTime();
  const grossIncl = qtySold * 115;
  return {
    id,
    source:           'square',
    startStr:         date,
    endStr:           date,
    startMs,
    days:             1,
    lineCount:        1,
    totalRevenue:     grossIncl,
    totalQtySold:     qtySold,
    rawLines:         [{ name: 'Beer', qtySold, grossIncl }],
    overlappingCycles: [],
    allocationMethod: 'none',
    status:           null,
    meta:             { sourceFormat: 'square', lineTotalsBasis: 'line_total', gstBasis: 'assumed_incl' },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildSalesPerformanceResult', () => {
  it('voided report is excluded from results', () => {
    const active = makeReport('r-active', '2026-09-28', '2026-10-04');
    const voided = makeReport('r-voided', '2026-09-28', '2026-10-04', { status: 'voided' });

    const matchesByReport: Record<string, MatchData | null> = {
      'r-active': makeMatch('r-active', 'p-active', 10),
      'r-voided': makeMatch('r-voided', 'p-voided', 10),
    };

    const result = buildSalesPerformanceResult(
      [active, voided],
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'top_sellers' },
      TODAY_NZ,
    );

    const topSellers: any[] = result.top_sellers ?? [];
    const productIds = topSellers.map((r: any) => r.productId);
    expect(productIds).toContain('p-active');
    expect(productIds).not.toContain('p-voided');
  });

  it('revenueExGst is null in weekly table when a legacy report contributes', () => {
    // Legacy report: no lineTotalsBasis = 'line_total'
    const legacyReport = makeReport('r-legacy', '2026-09-28', '2026-10-04', { hasLineTotals: false });
    const matchesByReport: Record<string, MatchData | null> = {
      'r-legacy': makeMatch('r-legacy', 'p1', 5),
    };

    const result = buildSalesPerformanceResult(
      [legacyReport],
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );

    // The week containing 2026-09-28 is in the last4 window; its allSales.revenueExGst must be null
    const table: any[] = result.weeklyTable;
    const wk = table.find((r: any) => r.weekStart === '2026-09-28');
    expect(wk).toBeDefined();
    expect(wk!.allSales.revenueExGst).toBeNull();
  });

  it('product ambiguity returns candidates (up to 5), not a guess', () => {
    // Create several reports with similar product names
    const reports: ActiveReport[] = [];
    const matchesByReport: Record<string, MatchData | null> = {};

    const names = ['Sauvignon Blanc Glass', 'Sauvignon Blanc Bottle', 'Sauvignon Blanc Carafe',
                   'Sauvignon Blanc Magnum', 'Sauvignon Blanc NV', 'Sauvignon Blanc Reserve'];
    names.forEach((name, i) => {
      const rId = `r${i}`;
      const pId = `p${i}`;
      const r   = makeReport(rId, '2026-09-28', '2026-10-04');
      reports.push(r);
      matchesByReport[rId] = {
        matched: 1, total: 1, matchedRevenue: 500, matchedQty: 5,
        matches: [{ productId: pId, productName: name, name, qtySold: 5, gross: 500 }],
      };
    });

    const result = buildSalesPerformanceResult(
      reports,
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'product', product_name: 'Sauvignon Blanc' },
      TODAY_NZ,
    );

    expect(result.product).toBeDefined();
    expect((result.product as any).found).toBe(false);
    expect((result.product as any).ambiguous).toBe(true);
    const candidates: string[] = (result.product as any).candidates;
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it('result always includes required coverage fields', () => {
    const r = makeReport('r1', '2026-09-28', '2026-10-04');
    const result = buildSalesPerformanceResult(
      [r],
      { r1: makeMatch('r1', 'p1', 10) },
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );

    expect(typeof result.weeksCovered).toBe('number');
    expect(Array.isArray(result.missingWeeks)).toBe(true);
    expect(typeof result.last4CoveredDays).toBe('number');
    expect(typeof result.prev4CoveredDays).toBe('number');
    expect(result.matchCoverage).toBeDefined();
    expect(typeof (result.matchCoverage as any).linesPct).toBe('number');
    expect(typeof (result.matchCoverage as any).unitsPct).toBe('number');
    expect(result.revenueBasis).toBe('ex GST');
    expect(typeof result.reportsNotMatched).toBe('number');
    expect(Array.isArray(result.weeklyTable)).toBe(true);
  });

  it('serialised result stays under 6 000 chars even with 200 products', () => {
    const reports: ActiveReport[] = [];
    const matchesByReport: Record<string, MatchData | null> = {};

    for (let i = 0; i < 200; i++) {
      const rId = `r${i}`;
      const pId = `p${i}`;
      const r   = makeReport(rId, '2026-09-28', '2026-10-04');
      reports.push(r);
      matchesByReport[rId] = {
        matched: 1, total: 1, matchedRevenue: 500, matchedQty: 5,
        matches: [{ productId: pId, productName: `Long Product Name Number ${i} Extra Padding`, name: `LPN${i}`, qtySold: 5, gross: 500 }],
      };
    }

    const result = buildSalesPerformanceResult(
      reports,
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'top_sellers' },
      TODAY_NZ,
    );

    expect(JSON.stringify(result).length).toBeLessThan(6000);
  });
});

// ── normaliseSalesReport ──────────────────────────────────────────────────────

describe('normaliseSalesReport', () => {
  it('normalises a Square daily doc correctly', () => {
    const n = normaliseSalesReport('square-abc123', {
      source: 'square',
      date:   '2026-09-28',
      lines:  [{ name: 'Beer', qtySold: 5, grossIncl: 575 }],
    });
    expect(n.sourceFormat).toBe('square');
    expect(n.startStr).toBe('2026-09-28');
    expect(n.endStr).toBe('2026-09-28');
    expect(n.days).toBe(1);
    expect(n.lineTotalsBasis).toBe('line_total');
    expect(n.gstBasis).toBe('assumed_incl');
    expect(n.rawLines).toHaveLength(1);
    expect(n.source).toBe('square');
  });

  it('normalises a CSV/PDF import doc', () => {
    const n = normaliseSalesReport('report-abc', {
      source: 'bustle',
      report: {
        period: { start: '2026-09-22', end: '2026-09-28' },
        lines:  [{ name: 'Beer', qtySold: 5, grossIncl: 575, netExcl: 500 }],
        meta:   { sourceFormat: 'bustle_rich', lineTotalsBasis: 'line_total', gstBasis: 'explicit' },
      },
    });
    expect(n.sourceFormat).toBe('bustle_rich');
    expect(n.startStr).toBe('2026-09-22');
    expect(n.endStr).toBe('2026-09-28');
    expect(n.lineTotalsBasis).toBe('line_total');
    expect(n.gstBasis).toBe('explicit');
  });

  it('legacy doc (no meta) gets unknown basis', () => {
    const n = normaliseSalesReport('old-report', {
      source: 'bustle',
      report: { lines: [{ name: 'Beer', qtySold: 3 }] },
    });
    expect(n.lineTotalsBasis).toBe('unknown');
    expect(n.gstBasis).toBe('unknown');
  });
});

// ── incl-only revenue ─────────────────────────────────────────────────────────

describe('incl-only revenue (assumed_incl gstBasis)', () => {
  it('Square report sets revenueExGst=null and revenueInclGst set on weekly table row', () => {
    const r = makeSquareReport('sq-1', '2026-09-28', 10);
    const matchesByReport: Record<string, MatchData | null> = {
      'sq-1': makeMatch('sq-1', 'p-beer', 10),
    };
    const result = buildSalesPerformanceResult(
      [r],
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );
    const wkRow = (result.weeklyTable as any[]).find((w: any) => w.weekStart === '2026-09-28');
    expect(wkRow).toBeDefined();
    expect(wkRow.allSales.revenueExGst).toBeNull();
    expect(typeof wkRow.allSales.revenueInclGst).toBe('number');
    expect(wkRow.allSales.revenueInclGst).toBeGreaterThan(0);
    expect(wkRow.allSales.inclOnly).toBe(true);
    expect((result.summary as any)?.revenueNote).toMatch(/incl/i);
  });
});

// ── actualClosing=0 → Sold out ────────────────────────────────────────────────

describe('stock status', () => {
  it('product with actualClosing=0 in latest snapshot → status Sold out', () => {
    const r = makeReport('r1', '2026-09-28', '2026-10-04');
    const matchesByReport: Record<string, MatchData | null> = {
      r1: makeMatch('r1', 'p1', 10),
    };
    const stockMap: Record<string, StockEntry> = {
      p1: { count: 0, cycleNumber: 5 },
    };
    const result = buildSalesPerformanceResult(
      [r], matchesByReport, stockMap, { question_type: 'top_sellers' }, TODAY_NZ,
    );
    const sellers = result.top_sellers as any[];
    const p1 = sellers.find((s: any) => s.productId === 'p1');
    expect(p1).toBeDefined();
    expect(p1.status).toBe('Sold out');
  });
});

// ── matchDocToMatchData unitsPct ───────────────────────────────────────────────

describe('matchDocToMatchData — match doc without matchedQty gives correct unitsPct', () => {
  it('computes matchedQty from matches array when top-level matchedQty is absent', () => {
    const rawDoc = {
      matches: [
        { productId: 'p1', productName: 'Beer', name: 'Beer', qtySold: 5, gross: 500 },
        { productId: 'p2', productName: 'Wine', name: 'Wine', qtySold: 3, gross: 300 },
      ],
      // no top-level matchedQty
    };
    const md = matchDocToMatchData(rawDoc);
    expect(md.matchedQty).toBe(8);
    expect(md.matchedRevenue).toBe(800);
    expect(md.matched).toBe(2);   // matches.length
    expect(md.total).toBeNull();  // d.counts?.total ?? null
  });

  it('correct unitsPct in buildSalesPerformanceResult with doc-style match data', () => {
    const report = makeReport('r1', '2026-09-28', '2026-10-04', { qtySold: 20 });
    // Match doc: 10 of 20 units matched
    const rawDoc = {
      matches: [{ productId: 'p1', productName: 'Beer', name: 'Beer', qtySold: 10, gross: 1000 }],
    };
    const md = matchDocToMatchData(rawDoc);
    const result = buildSalesPerformanceResult(
      [report],
      { r1: md },
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );
    const unitsPct = (result.matchCoverage as any).unitsPct;
    expect(unitsPct).toBe(50); // 10 matched / 20 total = 50%
  });
});

// ── separate allSales vs matchedProducts ──────────────────────────────────────

describe('summary allSales vs matchedProducts', () => {
  it('allSales.units equals sum of all raw lines in the window (not just matched)', () => {
    // One matched report (10 units) + one unmatched report (15 units)
    const matched   = makeReport('r-matched',   '2026-09-28', '2026-10-04', { qtySold: 10 });
    const unmatched = makeReport('r-unmatched', '2026-09-28', '2026-10-04', { qtySold: 15 });
    const matchesByReport: Record<string, MatchData | null> = {
      'r-matched':   makeMatch('r-matched', 'p1', 10),
      'r-unmatched': null,
    };
    const result = buildSalesPerformanceResult(
      [matched, unmatched],
      matchesByReport,
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );
    const s = result.summary as any;
    // allSales should include both reports (25 units in last4)
    expect(s.allSales.last4Units).toBeCloseTo(25, 0);
    // matchedProducts should include only matched (10 units)
    expect(s.matchedProducts.last4Units).toBeCloseTo(10, 0);
  });

  it('matchedProducts.units < allSales.units when coverage < 100%', () => {
    const r = makeReport('r1', '2026-09-28', '2026-10-04', { qtySold: 20 });
    const md = matchDocToMatchData({
      matches: [{ productId: 'p1', productName: 'Beer', name: 'Beer', qtySold: 8, gross: 800 }],
    });
    const result = buildSalesPerformanceResult(
      [r],
      { r1: md },
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );
    const s = result.summary as any;
    expect(s.allSales.last4Units).toBeGreaterThan(s.matchedProducts.last4Units);
  });

  it('weekly table row has allSales and matchedProducts fields', () => {
    const r = makeReport('r1', '2026-09-28', '2026-10-04', { qtySold: 20 });
    const result = buildSalesPerformanceResult(
      [r],
      { r1: makeMatch('r1', 'p1', 20) },
      EMPTY_STOCK,
      { question_type: 'summary', weeks: 4 },
      TODAY_NZ,
    );
    const wk = (result.weeklyTable as any[]).find((w: any) => w.weekStart === '2026-09-28');
    expect(wk).toBeDefined();
    expect(typeof wk.allSales.units).toBe('number');
    expect(typeof wk.allSales.revenueInclGst).toBe('number');
    expect(typeof wk.matchedProducts.units).toBe('number');
  });
});
