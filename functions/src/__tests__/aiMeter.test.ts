// Mock variables prefixed 'mock' are hoisted above jest.mock by Babel
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn((path: string) => ({
  get: () => mockDocGet(path),
  set: (d: any, o?: any) => mockDocSet(d, o),
}));

jest.mock('firebase-admin', () => ({
  firestore: Object.assign(
    jest.fn(() => ({ doc: mockDoc })),
    { FieldValue: { serverTimestamp: jest.fn() } }
  ),
}));

import { checkAiLimit, trackAiCall, PLAN_LIMITS } from '../services/aiMeter';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupMocks(usageData: any, venueData: any = { billingPlan: 'beta' }) {
  mockDocGet.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/aiUsage/')
        ? { data: () => usageData, exists: !!usageData }
        : { data: () => venueData, exists: true }
    )
  );
}

beforeEach(() => { jest.clearAllMocks(); });

// ── PLAN_LIMITS shape ─────────────────────────────────────────────────────────

describe('PLAN_LIMITS', () => {
  test('invoice_ocr limits rebased to abuse-level', () => {
    expect(PLAN_LIMITS.beta.invoice_ocr).toBe(300);
    expect(PLAN_LIMITS.core.invoice_ocr).toBe(300);
    expect(PLAN_LIMITS.core_plus.invoice_ocr).toBe(400);
  });

  test('totals rebased', () => {
    expect(PLAN_LIMITS.beta.total).toBe(600);
    expect(PLAN_LIMITS.core.total).toBe(500);
    expect(PLAN_LIMITS.core_plus.total).toBe(800);
  });
});

// ── checkAiLimit ──────────────────────────────────────────────────────────────

describe('checkAiLimit', () => {
  test('allows when no prior usage', async () => {
    setupMocks(null);
    const r = await checkAiLimit('v1', 'invoice_ocr');
    expect(r.allowed).toBe(true);
  });

  test('blocks on feature limit', async () => {
    setupMocks({ totalCalls: 10, breakdown: { invoice_ocr: 300 } }); // beta limit
    const r = await checkAiLimit('v1', 'invoice_ocr');
    expect(r.allowed).toBe(false);
    expect(r.limitError?.feature).toBe('invoice_ocr');
    expect(r.limitError?.error).toBe('limit_reached');
  });

  test('total limit blocks before feature check when both exceeded', async () => {
    setupMocks({ totalCalls: 600, breakdown: { invoice_ocr: 300 } });
    const r = await checkAiLimit('v1', 'invoice_ocr');
    expect(r.allowed).toBe(false);
    expect(r.limitError?.feature).toBe('total');
  });

  test('feature limit fires with total headroom', async () => {
    setupMocks({ totalCalls: 10, breakdown: { invoice_ocr: 300 } });
    const r = await checkAiLimit('v1', 'invoice_ocr');
    expect(r.allowed).toBe(false);
    expect(r.limitError?.feature).toBe('invoice_ocr');
  });

  test('limitError block shape is complete', async () => {
    setupMocks({ totalCalls: 10, breakdown: { invoice_ocr: 300 } });
    const { limitError } = await checkAiLimit('v1', 'invoice_ocr');
    expect(limitError).toMatchObject({
      error: 'limit_reached',
      feature: 'invoice_ocr',
      used: 300,
      limit: 300,
      plan: 'beta',
    });
    expect(typeof limitError?.resetsAt).toBe('string');
    expect(typeof limitError?.message).toBe('string');
    expect(typeof limitError?.upgradeAvailable).toBe('boolean');
  });

  test('unknown callType falls back to total as feature limit', async () => {
    // featureLimit = totalLimit (600 for beta); 600 used >= 600 → blocked on feature
    setupMocks({ totalCalls: 10, breakdown: { mystery_type: 600 } });
    const r = await checkAiLimit('v1', 'mystery_type' as any);
    expect(r.allowed).toBe(false);
    expect(r.limitError?.feature).toBe('mystery_type');
  });

  describe('14-day grace period', () => {
    test('new core venue (5d old) gets beta limits — 520 calls: allowed', async () => {
      // core total=500 → blocked; beta total=600 → allowed; grace switches to beta
      const createdAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
      setupMocks(
        { totalCalls: 520, breakdown: {} },
        { billingPlan: 'core', createdAt: { toMillis: () => createdAt } }
      );
      const r = await checkAiLimit('v1', 'invoice_ocr');
      expect(r.allowed).toBe(true);
    });

    test('old core venue (20d) uses core limits — 520 calls: blocked', async () => {
      const createdAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
      setupMocks(
        { totalCalls: 520, breakdown: {} },
        { billingPlan: 'core', createdAt: { toMillis: () => createdAt } }
      );
      const r = await checkAiLimit('v1', 'invoice_ocr');
      expect(r.allowed).toBe(false);
      expect(r.limitError?.feature).toBe('total');
    });
  });
});

// ── trackAiCall — 80% warning boundary ────────────────────────────────────────

describe('trackAiCall — 80% warning boundary (invoice_ocr beta limit = 300)', () => {
  // pct = Math.round((featureUsedAfter / featureLimit) * 100); warns when >= 80 && < 100
  const cases: Array<[string, number, boolean, number | undefined]> = [
    ['prev 237 → 238 = 79%: no warning', 237, false, undefined],
    ['prev 239 → 240 = 80%: warning',    239, true,  80],
    ['prev 296 → 297 = 99%: warning',    296, true,  99],
    ['prev 299 → 300 = 100%: no warning (block, not warning)', 299, false, undefined],
  ];

  test.each(cases)('%s', async (_label, prev, expectWarning, expectedPct) => {
    setupMocks({ totalCalls: 10, breakdown: { invoice_ocr: prev } });
    const state = await trackAiCall('v1', 'invoice_ocr');
    if (expectWarning) {
      expect(state.usageWarning).not.toBeNull();
      expect(state.usageWarning?.percentUsed).toBe(expectedPct);
    } else {
      expect(state.usageWarning).toBeNull();
    }
  });
});
