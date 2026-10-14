/**
 * Tests for the Stock Accuracy limited_baseline path in hostiHealth.
 *
 * getHostiHealthStage is an I/O-heavy function; we isolate the test by mocking
 * all Firestore calls and feeding them controlled snapshot data so only the
 * stock-accuracy section of calculateFullScore matters.
 */

// Mock firebase before importing the module under test
jest.mock('../../firebase', () => ({ db: {} }));

const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args: any[]) => args.join('/')),
  doc:        jest.fn((...args: any[]) => args.join('/')),
  getDocs:    (...args: any[]) => mockGetDocs(...args),
  getDoc:     (...args: any[]) => mockGetDoc(...args),
  query:      jest.fn((...args: any[]) => args[0]),
  where:      jest.fn(),
  orderBy:    jest.fn(),
  limit:      jest.fn(),
  setDoc:     jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  Timestamp:  { fromDate: jest.fn((d: Date) => d) },
}));

jest.mock('../../crashReporting', () => ({ captureError: jest.fn() }));
jest.mock('firebase/auth',       () => ({ getAuth: () => ({ currentUser: null }) }));

// Mock sub-services called by calculateFullScore so they degrade silently
jest.mock('../abductiveInsights', () => ({ generateAbductiveInsights: async () => [] }));
jest.mock('../predictions',       () => ({ generateStockoutPredictions: async () => null }));

import { getHostiHealthStage, HostiHealthStage3 } from '../hostiHealth';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeSnapshotSummary(
  itemsWithBaseline: number,
  totalItemsCounted: number,
  displayTotalStockValue = 1000,
  displayTotalVarianceDollars = 20,
) {
  return {
    totalItemsCounted,
    itemsWithBaseline,
    itemsWithoutBaseline: totalItemsCounted - itemsWithBaseline,
    displayTotalStockValue,
    displayTotalVarianceDollars,
    totalStockValue: displayTotalStockValue,
    totalVarianceDollars: displayTotalVarianceDollars,
    itemsPricedByInvoice: 0,
  };
}

function makeDeptSnap(deptId: string) {
  return { id: deptId, data: () => ({ name: deptId }) };
}

function makeSnapshotDoc(summary: any, opts: { hasSales?: boolean; hasInvoices?: boolean } = {}) {
  return {
    id: 'cycle-5',
    data: () => ({
      cycleNumber: 5,
      summary,
      dataCompleteness: {
        hasPrices: true,
        pricedItemPercent: 80,
        hasSales: opts.hasSales ?? false,
        hasInvoices: opts.hasInvoices ?? false,
      },
      items: [],
    }),
  };
}

function makeEmptySnap()  { return { empty: true,  docs: [] }; }
function makeSnap(docs: any[]) { return { empty: docs.length === 0, docs }; }

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hostiHealth — Stock Accuracy limited_baseline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Venue settings and monthly scores — return empty so non-stockAccuracy KPIs stay null
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  });

  it('returns stockAccuracyNullReason limited_baseline when < 50% of items have a baseline', async () => {
    // 2 items with baseline, 6 total → 33% < 50%
    const summary = makeSnapshotSummary(2, 6);

    mockGetDocs.mockImplementation((q: any) => {
      const path = String(q);
      if (path.includes('departments') && !path.includes('snapshots') && !path.includes('areas') &&
          !path.includes('cycles') && !path.includes('orders') && !path.includes('invoices') &&
          !path.includes('profitRecoverySnapshots') && !path.includes('labour') &&
          !path.includes('settings')) {
        return Promise.resolve(makeSnap([makeDeptSnap('bar')]));
      }
      if (path.includes('snapshots')) {
        return Promise.resolve(makeSnap([makeSnapshotDoc(summary)]));
      }
      return Promise.resolve(makeEmptySnap());
    });

    const result = await getHostiHealthStage('venue-1', 5, 20, 3, 5000);
    expect(result.stage).toBe(3);
    const stage3 = result as HostiHealthStage3;
    expect(stage3.kpis.stockAccuracy).toBeNull();
    expect(stage3.kpis.stockAccuracyNullReason).toBe('limited_baseline');
  });

  it('computes a numeric stockAccuracy when >= 50% of items have a baseline', async () => {
    // 4 items with baseline, 6 total → 67% ≥ 50%
    const summary = makeSnapshotSummary(4, 6, 1000, 10);

    mockGetDocs.mockImplementation((q: any) => {
      const path = String(q);
      if (path.includes('departments') && !path.includes('snapshots') && !path.includes('areas') &&
          !path.includes('cycles') && !path.includes('orders') && !path.includes('invoices') &&
          !path.includes('profitRecoverySnapshots') && !path.includes('settings')) {
        return Promise.resolve(makeSnap([makeDeptSnap('bar')]));
      }
      if (path.includes('snapshots')) {
        return Promise.resolve(makeSnap([makeSnapshotDoc(summary, { hasSales: true })]));
      }
      return Promise.resolve(makeEmptySnap());
    });

    const result = await getHostiHealthStage('venue-1', 5, 20, 3, 5000);
    expect(result.stage).toBe(3);
    const stage3 = result as HostiHealthStage3;
    expect(stage3.kpis.stockAccuracy).not.toBeNull();
    expect(stage3.kpis.stockAccuracyNullReason).not.toBe('limited_baseline');
  });
});

describe('hostiHealth — Stock Accuracy no_usage_data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  });

  it('returns stockAccuracyNullReason no_usage_data when no dept snapshot has sales or invoices', async () => {
    const summary = makeSnapshotSummary(6, 6);

    mockGetDocs.mockImplementation((q: any) => {
      const path = String(q);
      if (path.includes('departments') && !path.includes('snapshots') && !path.includes('areas') &&
          !path.includes('cycles') && !path.includes('orders') && !path.includes('invoices') &&
          !path.includes('profitRecoverySnapshots') && !path.includes('settings')) {
        return Promise.resolve(makeSnap([makeDeptSnap('bar')]));
      }
      if (path.includes('snapshots')) {
        // hasSales: false, hasInvoices: false
        return Promise.resolve(makeSnap([makeSnapshotDoc(summary)]));
      }
      return Promise.resolve(makeEmptySnap());
    });

    const result = await getHostiHealthStage('venue-1', 5, 20, 3, 5000);
    expect(result.stage).toBe(3);
    const stage3 = result as HostiHealthStage3;
    expect(stage3.kpis.stockAccuracy).toBeNull();
    expect(stage3.kpis.stockAccuracyNullReason).toBe('no_usage_data');
  });

  it('does not set no_usage_data when at least one snapshot has sales data', async () => {
    const summary = makeSnapshotSummary(6, 6, 1000, 10);

    mockGetDocs.mockImplementation((q: any) => {
      const path = String(q);
      if (path.includes('departments') && !path.includes('snapshots') && !path.includes('areas') &&
          !path.includes('cycles') && !path.includes('orders') && !path.includes('invoices') &&
          !path.includes('profitRecoverySnapshots') && !path.includes('settings')) {
        return Promise.resolve(makeSnap([makeDeptSnap('bar')]));
      }
      if (path.includes('snapshots')) {
        return Promise.resolve(makeSnap([makeSnapshotDoc(summary, { hasSales: true })]));
      }
      return Promise.resolve(makeEmptySnap());
    });

    const result = await getHostiHealthStage('venue-1', 5, 20, 3, 5000);
    expect(result.stage).toBe(3);
    const stage3 = result as HostiHealthStage3;
    expect(stage3.kpis.stockAccuracyNullReason).not.toBe('no_usage_data');
  });
});
