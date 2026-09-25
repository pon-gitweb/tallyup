/**
 * Tests for buildPriceChangeDetail (Part C1 pure function).
 *
 * Covers:
 *  - 4+ events per product are all returned (no per-product cap)
 *  - windowChange is a direct endpoint-to-endpoint calculation,
 *    not a sum of intermediate step percentages (Vinegar White scenario)
 *  - hasData:false when no records supplied
 *  - Single-event product gets correct windowChange (== its own old→new)
 */

import { buildPriceChangeDetail, PriceDetailRawRecord } from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_MS = new Date('2026-08-01T10:00:00Z').getTime();
const DAY_MS  = 24 * 60 * 60 * 1000;

function rec(
  productId: string,
  productName: string,
  oldPrice: number,
  newPrice: number,
  daysAgo: number,
  supplierName = 'TestCo',
): PriceDetailRawRecord {
  const changePercent = oldPrice > 0
    ? Math.round(((newPrice - oldPrice) / oldPrice) * 10000) / 100
    : 0;
  return {
    productId,
    productName,
    oldPrice,
    newPrice,
    changePercent,
    direction: newPrice >= oldPrice ? 'increase' : 'decrease',
    supplierName,
    dateMs: BASE_MS - daysAgo * DAY_MS,
  };
}

// ── Suite: hasData:false when empty ──────────────────────────────────────────

describe('buildPriceChangeDetail – hasData:false when no records', () => {
  it('returns hasData:false and empty products for empty input', () => {
    const result = buildPriceChangeDetail([], 90);
    expect(result.hasData).toBe(false);
    expect(result.products).toHaveLength(0);
    expect(result.windowDays).toBe(90);
  });
});

// ── Suite: all events returned (no per-product cap) ───────────────────────────

describe('buildPriceChangeDetail – returns all events, no 3-event cap', () => {
  it('returns 4 events for a product with 4 records', () => {
    const records: PriceDetailRawRecord[] = [
      rec('prod-1', 'Pale Ale Keg 50L', 250, 260, 80),
      rec('prod-1', 'Pale Ale Keg 50L', 260, 270, 60),
      rec('prod-1', 'Pale Ale Keg 50L', 270, 275, 40),
      rec('prod-1', 'Pale Ale Keg 50L', 275, 280, 20),
    ];

    const result = buildPriceChangeDetail(records, 90);

    expect(result.hasData).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].events).toHaveLength(4);
  });

  it('events are sorted chronologically (oldest first)', () => {
    const records: PriceDetailRawRecord[] = [
      rec('prod-2', 'House Red 750ml', 15, 17, 20), // most recent
      rec('prod-2', 'House Red 750ml', 13, 15, 50), // older
      rec('prod-2', 'House Red 750ml', 11, 13, 80), // oldest
    ];

    const result = buildPriceChangeDetail(records, 90);
    const events = result.products[0].events;

    expect(events[0].oldPrice).toBe(11); // oldest event first
    expect(events[1].oldPrice).toBe(13);
    expect(events[2].oldPrice).toBe(15); // most recent last
  });
});

// ── Suite: windowChange — endpoint-to-endpoint, not sum of steps ─────────────

describe('buildPriceChangeDetail – windowChange is endpoint-to-endpoint', () => {
  /**
   * Vinegar White scenario:
   *   Event 1:  $10.00 → $15.00  (+50%)
   *   Event 2:  $15.00 →  $9.00  (−40%)
   *   Event 3:   $9.00 → $12.00  (+33.33%)
   *
   * Naive sum of individual changePercents: 50 + (−40) + 33.33 ≈ 43.33
   * Correct endpoint-to-endpoint: ($12 − $10) / $10 = 20.00%
   */
  it('Vinegar White: windowChange is 20% (endpoint), not ~43% (sum of steps)', () => {
    const records: PriceDetailRawRecord[] = [
      rec('prod-vw', 'Vinegar White 5L', 10, 15, 60), // oldest
      rec('prod-vw', 'Vinegar White 5L', 15,  9, 40), // middle
      rec('prod-vw', 'Vinegar White 5L',  9, 12, 20), // most recent
    ];

    const result = buildPriceChangeDetail(records, 90);
    expect(result.products[0].events).toHaveLength(3);

    const wc = result.products[0].windowChange!;
    expect(wc.oldPrice).toBe(10);  // earliest event's oldPrice
    expect(wc.newPrice).toBe(12);  // latest event's newPrice
    expect(wc.changePercent).toBe(20); // direct (12-10)/10 * 100

    // Confirm the sum-of-steps is different (i.e. this is a meaningful test)
    const sumOfSteps = records.reduce((s, r) => s + r.changePercent, 0);
    expect(Math.round(sumOfSteps)).not.toBe(Math.round(wc.changePercent));
  });

  it('single-event product: windowChange equals that event\'s old→new', () => {
    const records: PriceDetailRawRecord[] = [
      rec('prod-single', 'Sparkling Water 1L', 3.50, 4.00, 10),
    ];

    const result = buildPriceChangeDetail(records, 90);
    const wc = result.products[0].windowChange!;

    expect(wc.oldPrice).toBe(3.50);
    expect(wc.newPrice).toBe(4.00);
    expect(wc.changePercent).toBe(Math.round(((4 - 3.5) / 3.5) * 10000) / 100);
  });

  it('windowChange direction is "decrease" when net endpoint change is negative', () => {
    const records: PriceDetailRawRecord[] = [
      rec('prod-down', 'Bulk Salt 25kg', 20, 25, 30),
      rec('prod-down', 'Bulk Salt 25kg', 25, 18, 10),
    ];

    const result = buildPriceChangeDetail(records, 90);
    expect(result.products[0].windowChange!.direction).toBe('decrease');
    expect(result.products[0].windowChange!.oldPrice).toBe(20);
    expect(result.products[0].windowChange!.newPrice).toBe(18);
  });
});

// ── Suite: multi-product grouping ─────────────────────────────────────────────

describe('buildPriceChangeDetail – multi-product grouping', () => {
  it('groups events by productId, one entry per product', () => {
    const records: PriceDetailRawRecord[] = [
      rec('p-a', 'Cabernet 750ml', 18, 20, 30),
      rec('p-b', 'Pinot Noir 750ml', 22, 24, 45),
      rec('p-a', 'Cabernet 750ml', 20, 22, 10),
    ];

    const result = buildPriceChangeDetail(records, 90);

    expect(result.products).toHaveLength(2);
    const cabEntry = result.products.find(p => p.productId === 'p-a')!;
    expect(cabEntry.events).toHaveLength(2);
    const pinotEntry = result.products.find(p => p.productId === 'p-b')!;
    expect(pinotEntry.events).toHaveLength(1);
  });
});
