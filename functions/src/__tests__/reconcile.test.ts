/**
 * Reconcile engine tests — Matchbox Bar fixture.
 *
 * Fixture: Tuesday counts, Monday closed (closedWeekdays=[1]),
 * pre_service timing, Pacific/Auckland timezone.
 *
 * Opening count: 2025-01-07 (Tuesday) → thisCountStart: 2025-01-14 (Tuesday)
 * Window (pre_service, Mon closed): 2025-01-07..2025-01-12 (6 dates, Mon 01-13 excl)
 */

import { windowDates } from '../reconcile/tradingWindow';
import { selectReports, ReportPeriod } from '../reconcile/selectReports';
import { aggregateSales, SalesMatchDoc } from '../reconcile/aggregateSales';
import { aggregateDeliveries, InvoiceInput } from '../reconcile/aggregateDeliveries';
import { classifyItems, SnapshotItemInput } from '../reconcile/classify';
import { reconcileSnapshot, ReconcileInputs } from '../reconcile/engine';

const TZ = 'Pacific/Auckland';
const CLOSED_MON: number[] = [1]; // Monday
const OPENING_START = new Date('2025-01-07T00:00:00Z'); // Tuesday NZ
const THIS_START    = new Date('2025-01-14T00:00:00Z'); // next Tuesday NZ

// Expected window dates (pre_service, Monday closed):
// 2025-01-07 Tue, 01-08 Wed, 01-09 Thu, 01-10 Fri, 01-11 Sat, 01-12 Sun
const EXPECTED_WINDOW = [
  '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10', '2025-01-11', '2025-01-12',
];

// Mon-Sun report for the same week
const MON_SUN_REPORT: ReportPeriod = {
  id: 'r-monsun',
  periodStart: new Date('2025-01-06T00:00:00Z'),
  periodEnd:   new Date('2025-01-12T00:00:00Z'),
};

// ── tradingWindow ──────────────────────────────────────────────────────────────

describe('windowDates', () => {
  it('pre_service: opening date inclusive, day before this count inclusive, Monday excluded', () => {
    const dates = windowDates(OPENING_START, THIS_START, TZ, CLOSED_MON, 'pre_service');
    expect(dates).toEqual(EXPECTED_WINDOW);
  });

  it('post_service: day after opening through this count date', () => {
    const dates = windowDates(OPENING_START, THIS_START, TZ, CLOSED_MON, 'post_service');
    // day after 01-07 = 01-08; up to 01-14; Mon 01-13 removed
    expect(dates).toContain('2025-01-08');
    expect(dates).toContain('2025-01-14');
    expect(dates).not.toContain('2025-01-07');
    expect(dates).not.toContain('2025-01-13');
  });

  it('no closed days: all calendar days included', () => {
    const dates = windowDates(OPENING_START, THIS_START, TZ, [], 'pre_service');
    expect(dates).toHaveLength(7); // 01-07 through 01-13
    expect(dates).toContain('2025-01-13'); // Monday included
  });
});

// ── selectReports ──────────────────────────────────────────────────────────────

describe('selectReports — Mon-Sun report attaches with Monday closed', () => {
  it('attaches when all report trading dates (Mon excluded) are in the window', () => {
    const result = selectReports(EXPECTED_WINDOW, TZ, CLOSED_MON, [MON_SUN_REPORT]);
    expect(result.attached).toHaveLength(1);
    expect(result.attached[0].id).toBe('r-monsun');
    expect(result.partial).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.coverageComplete).toBe(true);
    expect(result.uncoveredDates).toHaveLength(0);
  });
});

describe('selectReports — Mon-Sun report with no closed days becomes partial', () => {
  it('becomes partial because Mon 01-06 is outside the window', () => {
    // Window with no closed days: 01-07..01-13 (7 dates)
    const noClosedWindow = windowDates(OPENING_START, THIS_START, TZ, [], 'pre_service');
    const result = selectReports(noClosedWindow, TZ, [], [MON_SUN_REPORT]);
    // Report includes Mon 01-06 which is not in window → partial
    expect(result.partial).toHaveLength(1);
    expect(result.attached).toHaveLength(0);
  });

  it('coverage is incomplete when the only candidate is partial', () => {
    const noClosedWindow = windowDates(OPENING_START, THIS_START, TZ, [], 'pre_service');
    const result = selectReports(noClosedWindow, TZ, [], [MON_SUN_REPORT]);
    expect(result.coverageComplete).toBe(false);
    expect(result.uncoveredDates.length).toBeGreaterThan(0);
  });
});

describe('selectReports — two overlapping reports conflict', () => {
  // Report A: Mon-Wed 01-06 to 01-08; with Mon closed → Tue 01-07, Wed 01-08
  // Report B: Wed-Sun 01-08 to 01-12; with Mon closed → Wed 01-08, Thu-Sun
  // Both fully in window, share Wed 01-08 → conflict
  const reportA: ReportPeriod = {
    id: 'r-A',
    periodStart: new Date('2025-01-06T00:00:00Z'),
    periodEnd:   new Date('2025-01-08T00:00:00Z'),
  };
  const reportB: ReportPeriod = {
    id: 'r-B',
    periodStart: new Date('2025-01-08T00:00:00Z'),
    periodEnd:   new Date('2025-01-12T00:00:00Z'),
  };

  it('both reports are marked as conflicts', () => {
    const result = selectReports(EXPECTED_WINDOW, TZ, CLOSED_MON, [reportA, reportB]);
    const conflictIds = result.conflicts.map(r => r.id);
    expect(conflictIds).toContain('r-A');
    expect(conflictIds).toContain('r-B');
  });

  it('neither report attaches', () => {
    const result = selectReports(EXPECTED_WINDOW, TZ, CLOSED_MON, [reportA, reportB]);
    expect(result.attached).toHaveLength(0);
  });

  it('coverage is incomplete when both conflict', () => {
    const result = selectReports(EXPECTED_WINDOW, TZ, CLOSED_MON, [reportA, reportB]);
    expect(result.coverageComplete).toBe(false);
  });
});

// ── aggregateSales ─────────────────────────────────────────────────────────────

describe('aggregateSales — dollar line excluded', () => {
  const doc: SalesMatchDoc = {
    matches: [{
      productId: 'p-dollar',
      qtySold: 50,
      gross: 50.00,  // $1 each → ratio exactly 1.0 → excluded
      stockQty: 50,
      conversionSource: 'each',
    }],
  };

  it('excludes dollar lines from sold', () => {
    const result = aggregateSales([doc], {});
    expect(result.soldByProductId['p-dollar']).toBeUndefined();
    expect(result.excludedLines).toBe(1);
    expect(result.excludedRevenue).toBeCloseTo(50);
    expect(result.flagsByProductId['p-dollar']).toContain('dollar_line');
  });
});

describe('aggregateSales — default/unconvertible becomes sales_unit_unknown flag', () => {
  const doc: SalesMatchDoc = {
    matches: [
      { productId: 'p-def', qtySold: 10, gross: 100, stockQty: 10, conversionSource: 'default' },
      { productId: 'p-unc', qtySold: 5,  gross: 50,  stockQty: 5,  conversionSource: 'unconvertible' },
    ],
  };

  it('flags products with default or unconvertible conversions', () => {
    const result = aggregateSales([doc], {});
    expect(result.soldByProductId['p-def']).toBeUndefined();
    expect(result.soldByProductId['p-unc']).toBeUndefined();
    expect(result.flagsByProductId['p-def']).toContain('sales_unit_unknown');
    expect(result.flagsByProductId['p-unc']).toContain('sales_unit_unknown');
    expect(result.excludedLines).toBe(2);
  });
});

describe('aggregateSales — valid conversion sources included', () => {
  const doc: SalesMatchDoc = {
    matches: [
      { productId: 'p-ml',    qtySold: 10, gross: 80, stockQty: 0.4, conversionSource: 'servingMl' },
      { productId: 'p-ratio', qtySold: 5,  gross: 50, stockQty: 0.2, conversionSource: 'conversionRatio' },
      { productId: 'p-each',  qtySold: 3,  gross: 30, stockQty: 3,   conversionSource: 'each' },
    ],
  };

  it('sums stockQty for servingMl, conversionRatio, each', () => {
    const result = aggregateSales([doc], {});
    expect(result.soldByProductId['p-ml']).toBeCloseTo(0.4);
    expect(result.soldByProductId['p-ratio']).toBeCloseTo(0.2);
    expect(result.soldByProductId['p-each']).toBe(3);
    expect(result.excludedLines).toBe(0);
  });
});

describe('aggregateSales — mergedInto resolution', () => {
  const doc: SalesMatchDoc = {
    matches: [
      { productId: 'p-old', qtySold: 10, gross: 80, stockQty: 10, conversionSource: 'each' },
    ],
    recipeDeductions: [
      { productId: 'p-old', stockQty: 2 },
    ],
  };

  it('resolves p-old → p-new via mergedInto', () => {
    const mergedInto: Record<string, string> = { 'p-old': 'p-new' };
    const result = aggregateSales([doc], mergedInto);
    expect(result.soldByProductId['p-old']).toBeUndefined();
    expect(result.soldByProductId['p-new']).toBe(12); // 10 matches + 2 recipe
  });
});

describe('aggregateSales — recipe deductions included', () => {
  const doc: SalesMatchDoc = {
    recipeDeductions: [
      { productId: 'p-gin', stockQty: 3.5 },
      { productId: 'p-gin', stockQty: 1.5 },
      { productId: 'p-gin', stockQty: null }, // null excluded
    ],
  };

  it('sums numeric stockQty from recipe deductions', () => {
    const result = aggregateSales([doc], {});
    expect(result.soldByProductId['p-gin']).toBeCloseTo(5.0);
  });
});

// ── aggregateDeliveries ────────────────────────────────────────────────────────

describe('aggregateDeliveries', () => {
  const invoicesInWindow: InvoiceInput[] = [
    {
      id: 'inv-1',
      invoiceDateTimestamp: new Date('2025-01-09T00:00:00Z'), // Thu, in window
      type: null,
      lines: [
        { productId: 'p-A', qty: 6 },
        { productId: 'p-B', qty: 12 },
        { productId: null,  qty: 5 },   // unlinked
        { productId: 'p-C', qty: 3, caseSize: 24 }, // ambiguous
      ],
    },
    {
      id: 'inv-credit',
      invoiceDateTimestamp: new Date('2025-01-09T00:00:00Z'),
      type: 'credit_note',
      lines: [{ productId: 'p-A', qty: 2 }],
    },
    {
      id: 'inv-outside',
      invoiceDateTimestamp: new Date('2025-01-15T00:00:00Z'), // outside window
      type: null,
      lines: [{ productId: 'p-A', qty: 10 }],
    },
  ];

  it('sums received qty for in-window, non-credit invoices', () => {
    const r = aggregateDeliveries(invoicesInWindow, EXPECTED_WINDOW, TZ);
    expect(r.receivedByProductId['p-A']).toBe(6);
    expect(r.receivedByProductId['p-B']).toBe(12);
  });

  it('excludes credit notes', () => {
    const r = aggregateDeliveries(invoicesInWindow, EXPECTED_WINDOW, TZ);
    // credit note for p-A not counted
    expect(r.receivedByProductId['p-A']).toBe(6); // only inv-1
  });

  it('excludes invoices outside the window', () => {
    const r = aggregateDeliveries(invoicesInWindow, EXPECTED_WINDOW, TZ);
    expect(r.receivedByProductId['p-A']).toBe(6); // inv-outside not counted
  });

  it('counts unlinked lines', () => {
    const r = aggregateDeliveries(invoicesInWindow, EXPECTED_WINDOW, TZ);
    expect(r.unlinkedLines).toBe(1);
  });

  it('counts ambiguous (caseSize) lines', () => {
    const r = aggregateDeliveries(invoicesInWindow, EXPECTED_WINDOW, TZ);
    expect(r.ambiguousLines).toBe(1);
  });
});

// ── classifyItems ──────────────────────────────────────────────────────────────

describe('classifyItems — Kirin: 0/0 with sold 79 → alarm_sold_not_counted', () => {
  const kirin: SnapshotItemInput = {
    productId: 'p-kirin', name: 'Kirin', openingCount: 0, actualClosing: 0,
  };

  it('status is alarm_sold_not_counted', () => {
    const result = classifyItems({
      items: [kirin],
      soldByProductId: { 'p-kirin': 79 },
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('alarm_sold_not_counted');
    expect(result[0].sold).toBe(79);
  });
});

describe('classifyItems — Smirnoff: 1.2 to 22.7, no sales → usage_only', () => {
  const smirnoff: SnapshotItemInput = {
    productId: 'p-smirn', name: 'Smirnoff', openingCount: 1.2, actualClosing: 22.7,
  };

  it('status is usage_only with no sales', () => {
    const result = classifyItems({
      items: [smirnoff],
      soldByProductId: {},
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('usage_only');
    expect(result[0].usage).toBeCloseTo(1.2 + 0 - 22.7); // negative (implied gain)
  });
});

describe('classifyItems — tracked product with sold < usage gives shortfall', () => {
  // opening=10, closing=2, sold=3, received=0 → shortfall = 10+0-2-3 = 5
  const item: SnapshotItemInput = {
    productId: 'p-track', name: 'Tracked Spirit', openingCount: 10, actualClosing: 2,
    costPrice: 25,
  };

  it('shortfall = opening + received - closing - sold when positive', () => {
    const result = classifyItems({
      items: [item],
      soldByProductId: { 'p-track': 3 },
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('tracked');
    expect(result[0].shortfall).toBe(5);
    expect(result[0].shortfallKey).toBe('unexplained_by_recorded_sales');
    expect(result[0].shortfallDollars).toBeCloseTo(125);
    expect(result[0].impliedDelivery).toBeNull();
  });
});

describe('classifyItems — closing > opening - sold gives implied delivery', () => {
  // opening=5, closing=10, sold=3, received=0 → diff = 5+0-10-3 = -8 → impliedDelivery=8
  const item: SnapshotItemInput = {
    productId: 'p-impl', name: 'Implied Product', openingCount: 5, actualClosing: 10,
    costPrice: 20,
  };

  it('impliedDelivery is positive when closing exceeds expected', () => {
    const result = classifyItems({
      items: [item],
      soldByProductId: { 'p-impl': 3 },
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('tracked');
    expect(result[0].impliedDelivery).toBe(8);
    expect(result[0].impliedDeliveryDollars).toBeCloseTo(160);
    expect(result[0].shortfall).toBeNull();
  });
});

describe('classifyItems — shortfall suppressed when coverage incomplete', () => {
  const item: SnapshotItemInput = {
    productId: 'p-nocover', name: 'Uncovered Product', openingCount: 10, actualClosing: 2,
  };

  it('shortfall is null with reason when coverageComplete=false', () => {
    const result = classifyItems({
      items: [item],
      soldByProductId: { 'p-nocover': 3 },
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [],
      coverageComplete: false,
    });
    expect(result[0].shortfall).toBeNull();
    expect(result[0].shortfallReason).toBe('sales coverage incomplete');
  });
});

describe('classifyItems — direct_product mapping makes item tracked without sales', () => {
  const item: SnapshotItemInput = {
    productId: 'p-direct', name: 'Direct Product', openingCount: 5, actualClosing: 3,
  };

  it('tracked via direct_product mapping even with no sales', () => {
    const result = classifyItems({
      items: [item],
      soldByProductId: {},
      receivedByProductId: {},
      flagsByProductId: {},
      posProductMappings: [{ productId: 'p-direct', mappingType: 'direct_product' }],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('tracked');
    expect(result[0].sold).toBe(0);
    // shortfall = 5 + 0 - 3 - 0 = 2
    expect(result[0].shortfall).toBe(2);
  });
});

describe('classifyItems — sales_unit_unknown when only flagged sales', () => {
  const item: SnapshotItemInput = {
    productId: 'p-flagged', name: 'Default Conv Product', openingCount: 5, actualClosing: 3,
  };

  it('status is sales_unit_unknown with no valid sold but flagged entries', () => {
    const result = classifyItems({
      items: [item],
      soldByProductId: {},
      receivedByProductId: {},
      flagsByProductId: { 'p-flagged': ['sales_unit_unknown'] },
      posProductMappings: [],
      coverageComplete: true,
    });
    expect(result[0].status).toBe('sales_unit_unknown');
  });
});

// ── engine fingerprint stability ───────────────────────────────────────────────

describe('engine — fingerprint stability', () => {
  const BASE_INPUTS: ReconcileInputs = {
    tz: TZ,
    closedWeekdays: CLOSED_MON,
    countTiming: 'pre_service',
    openingCountStart: OPENING_START,
    thisCountStart: THIS_START,
    snapshotItems: [
      { productId: 'p-1', name: 'Item A', openingCount: 10, actualClosing: 8 },
    ],
    salesReports: [{
      id: 'r-1',
      periodStart: new Date('2025-01-06T00:00:00Z'),
      periodEnd: new Date('2025-01-12T00:00:00Z'),
      totalRevenue: 500,
    }],
    matchDocsByReportId: {
      'r-1': {
        matches: [{
          productId: 'p-1', qtySold: 5, gross: 50, stockQty: 5, conversionSource: 'each',
        }],
      },
    },
    invoices: [],
    posProductMappings: [{ id: 'm-1', productId: 'p-1', mappingType: 'direct_product' }],
    mergedInto: {},
  };

  it('same inputs produce the same fingerprint', () => {
    const r1 = reconcileSnapshot(BASE_INPUTS);
    const r2 = reconcileSnapshot(BASE_INPUTS);
    expect(r1.inputsFingerprint).toBe(r2.inputsFingerprint);
  });

  it('changed inputs produce a different fingerprint', () => {
    const r1 = reconcileSnapshot(BASE_INPUTS);
    const changed: ReconcileInputs = {
      ...BASE_INPUTS,
      snapshotItems: [
        { productId: 'p-1', name: 'Item A', openingCount: 10, actualClosing: 9 }, // changed
      ],
    };
    const r2 = reconcileSnapshot(changed);
    expect(r1.inputsFingerprint).not.toBe(r2.inputsFingerprint);
  });
});

// ── dry-run script write-method guard ─────────────────────────────────────────

describe('reconcile-dry-run.js — no Firestore write methods', () => {
  const fs = require('fs');
  const path = require('path');

  it('does not reference set/update/add/delete/batch/runTransaction on db or docRef', () => {
    const scriptPath = path.join(__dirname, '../../../scripts/admin/reconcile-dry-run.js');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`reconcile-dry-run.js not found at ${scriptPath}`);
    }
    const src = fs.readFileSync(scriptPath, 'utf8');
    // Remove comment lines before scanning
    const noComments = src.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = ['.set(', '.update(', '.add(', '.delete(', '.batch(', '.runTransaction('];
    for (const pattern of banned) {
      if (noComments.includes(pattern)) {
        throw new Error(`reconcile-dry-run.js references banned write method: ${pattern}`);
      }
    }
  });
});
