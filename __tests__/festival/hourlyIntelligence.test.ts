import { buildHourlyIntelligence } from '../../src/services/festival/hourlyIntelligence';

const ts = (ms: number) => ({ toMillis: () => ms });
const t = (h: number) => new Date(2026, 6, 7, h, 0).getTime();

const session = (completedAtMs: number, counts: any[]) => ({
  completedAt: ts(completedAtMs), counts,
});

describe('buildHourlyIntelligence', () => {
  it('returns empty result with fewer than 2 sessions', () => {
    expect(buildHourlyIntelligence([])).toMatchObject({
      buckets: [], peakHour: null, quietestHour: null, peakProduct: null,
    });
    expect(buildHourlyIntelligence([session(t(18), [])])).toMatchObject({ buckets: [] });
  });

  it('correctly calculates consumption between two sessions', () => {
    const sessions = [
      session(t(18), [{ productId: 'p1', actualCount: 100, productName: 'Heineken' }]),
      session(t(19), [{ productId: 'p1', actualCount: 75,  productName: 'Heineken' }]),
    ];
    const result = buildHourlyIntelligence(sessions);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].totalConsumed).toBe(25);
    expect(result.buckets[0].byProduct['p1']).toBe(25);
  });

  it('identifies peak hour correctly', () => {
    const sessions = [
      session(t(18), [{ productId: 'p1', actualCount: 100 }]),
      session(t(19), [{ productId: 'p1', actualCount: 80 }]),  // 20 consumed
      session(t(20), [{ productId: 'p1', actualCount: 30 }]),  // 50 consumed — peak
      session(t(21), [{ productId: 'p1', actualCount: 20 }]),  // 10 consumed
    ];
    const result = buildHourlyIntelligence(sessions);
    expect(result.peakHour?.hour).toBe(20);
    expect(result.peakHour?.totalConsumed).toBe(50);
  });

  it('identifies peak product correctly', () => {
    const sessions = [
      session(t(18), [
        { productId: 'p1', actualCount: 100, productName: 'Heineken' },
        { productId: 'p2', actualCount: 50,  productName: 'Espresso Martini' },
      ]),
      session(t(19), [
        { productId: 'p1', actualCount: 60,  productName: 'Heineken' },        // 40 consumed
        { productId: 'p2', actualCount: 40,  productName: 'Espresso Martini' }, // 10 consumed
      ]),
    ];
    const result = buildHourlyIntelligence(sessions);
    expect(result.peakProduct?.productName).toBe('Heineken');
    expect(result.peakProduct?.consumed).toBe(40);
  });

  it('accounts for received stock when calculating consumption', () => {
    const sessions = [
      session(t(18), [{ productId: 'p1', actualCount: 20 }]),
      // Stock went UP — restocked 50 units, consumed 10 → net +40
      session(t(19), [{ productId: 'p1', actualCount: 60, receivedQty: 50 }]),
    ];
    const result = buildHourlyIntelligence(sessions);
    // consumed = max(0, (20 + 50) - 60) = max(0, 10) = 10
    expect(result.buckets[0].totalConsumed).toBe(10);
  });

  it('never produces negative consumption', () => {
    const sessions = [
      session(t(18), [{ productId: 'p1', actualCount: 10 }]),
      session(t(19), [{ productId: 'p1', actualCount: 15 }]), // stock went up — no restock recorded
    ];
    const result = buildHourlyIntelligence(sessions);
    expect(result.buckets[0].totalConsumed).toBeGreaterThanOrEqual(0);
  });

  it('calculates average hourly velocity correctly', () => {
    const sessions = [
      session(t(18), [{ productId: 'p1', actualCount: 100 }]),
      session(t(19), [{ productId: 'p1', actualCount: 80 }]),  // 20
      session(t(20), [{ productId: 'p1', actualCount: 40 }]),  // 40
    ];
    const result = buildHourlyIntelligence(sessions);
    // 2 buckets: 20 + 40 = 60 total, avg = 30
    expect(result.averageHourlyVelocity).toBe(30);
    expect(result.totalConsumed).toBe(60);
  });

  it('handles missing toMillis gracefully', () => {
    const bad = [
      { completedAt: null, counts: [] },
      { completedAt: undefined, counts: [] },
    ];
    expect(() => buildHourlyIntelligence(bad as any)).not.toThrow();
  });
});
