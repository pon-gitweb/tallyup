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

    // The week containing 2026-09-28 is in the last4 window; its revenueExGst must be null
    const table: any[] = result.weeklyTable;
    const wk = table.find((r: any) => r.weekStart === '2026-09-28');
    expect(wk).toBeDefined();
    expect(wk!.revenueExGst).toBeNull();
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
