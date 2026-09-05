/**
 * Tests for the Stage-6 Suitee tool: get_gp_trend.
 *
 * aggregateGpTrend(keyword, records) → GpTrendResult
 *   Pure aggregation: fuzzy-matches `keyword` against the recipe names present
 *   in the supplied gpAlert records, then returns that recipe's events in
 *   chronological order.
 *
 * Uses the same tokenize+overlap matching as get_gp_analysis
 * (tokenizeForMatching, overlapCoefficient, isReliableMatch from nameMatching.ts).
 *
 * Hand-verification of fixtures
 * ─────────────────────────────
 * Timestamps (all 2026, UTC):
 *   1767225600000 → 2026-01-01
 *   1768435200000 → 2026-01-15
 *   1769904000000 → 2026-02-01
 *
 * Records contain two recipes:
 *   "Classic Negroni" (r1): two events on 2026-01-01 and 2026-02-01
 *   "Dry Martini"    (r2): one event on 2026-01-15
 *
 * keyword "negroni":
 *   Matches "Classic Negroni" (tokens overlap reliably)
 *   Events sorted by createdAtMs: 2026-01-01 then 2026-02-01
 *   Event 1: { date: '2026-01-01', oldGpPct: 75, newGpPct: 68, ingredientName: 'Gin' }
 *   Event 2: { date: '2026-02-01', oldGpPct: 68, newGpPct: 61, ingredientName: 'Campari' }
 *
 * keyword "martini":
 *   Matches "Dry Martini"
 *   Event: { date: '2026-01-15', oldGpPct: 80, newGpPct: 72, ingredientName: 'Vermouth' }
 *
 * keyword "unknown cocktail": no match → found: false, hasData: false
 * empty records: found: false regardless of keyword
 */

import { aggregateGpTrend, GpAlertRecord } from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DATE_JAN01 = 1767225600000; // 2026-01-01T00:00:00Z
const DATE_JAN15 = 1768435200000; // 2026-01-15T00:00:00Z
const DATE_FEB01 = 1769904000000; // 2026-02-01T00:00:00Z

const RECORDS: GpAlertRecord[] = [
  // Classic Negroni — two events (inserted out of chronological order to test sorting)
  {
    recipeName: 'Classic Negroni', recipeId: 'r1',
    ingredientName: 'Campari', oldGpPct: 68, newGpPct: 61, createdAtMs: DATE_FEB01,
  },
  {
    recipeName: 'Classic Negroni', recipeId: 'r1',
    ingredientName: 'Gin', oldGpPct: 75, newGpPct: 68, createdAtMs: DATE_JAN01,
  },
  // Dry Martini — one event
  {
    recipeName: 'Dry Martini', recipeId: 'r2',
    ingredientName: 'Vermouth', oldGpPct: 80, newGpPct: 72, createdAtMs: DATE_JAN15,
  },
];

// ── Suite A: aggregateGpTrend — core correctness ──────────────────────────────

describe('aggregateGpTrend — core correctness', () => {

  it('A1: hand-verified — keyword "negroni" matches "Classic Negroni", events chronological', () => {
    const result = aggregateGpTrend('negroni', RECORDS);

    expect(result.found).toBe(true);
    expect(result.recipeName).toBe('Classic Negroni');
    expect(result.hasData).toBe(true);
    expect(result.events).toHaveLength(2);

    // Events must be in chronological order (Jan 01 before Feb 01)
    const [first, second] = result.events;

    expect(first.date).toBe('2026-01-01');
    expect(first.ingredientName).toBe('Gin');
    expect(first.oldGpPct).toBe(75);
    expect(first.newGpPct).toBe(68);

    expect(second.date).toBe('2026-02-01');
    expect(second.ingredientName).toBe('Campari');
    expect(second.oldGpPct).toBe(68);
    expect(second.newGpPct).toBe(61);
  });

  it('A2: keyword "martini" matches "Dry Martini", single event with correct fields', () => {
    const result = aggregateGpTrend('martini', RECORDS);

    expect(result.found).toBe(true);
    expect(result.recipeName).toBe('Dry Martini');
    expect(result.hasData).toBe(true);
    expect(result.events).toHaveLength(1);

    const [ev] = result.events;
    expect(ev.date).toBe('2026-01-15');
    expect(ev.ingredientName).toBe('Vermouth');
    expect(ev.oldGpPct).toBe(80);
    expect(ev.newGpPct).toBe(72);
  });

  it('A3: unrecognised keyword → found:false, hasData:false', () => {
    const result = aggregateGpTrend('completely unknown cocktail xyz', RECORDS);
    expect(result.found).toBe(false);
    expect(result.recipeName).toBeNull();
    expect(result.events).toHaveLength(0);
    expect(result.hasData).toBe(false);
  });

  it('A4: empty records (no alerts in window) → found:false regardless of keyword', () => {
    const result = aggregateGpTrend('negroni', []);
    expect(result.found).toBe(false);
    expect(result.hasData).toBe(false);
  });

  it('A5: blank/empty keyword → found:false, hasData:false', () => {
    expect(aggregateGpTrend('', RECORDS).found).toBe(false);
    expect(aggregateGpTrend('   ', RECORDS).found).toBe(false);
  });

  it('A6: events for matched recipe are chronological even when records arrive out of order', () => {
    // RECORDS inserts Campari (Feb 01) before Gin (Jan 01) — sort must fix this.
    const result = aggregateGpTrend('negroni', RECORDS);
    const dates = result.events.map(e => e.date);
    expect(dates).toEqual(['2026-01-01', '2026-02-01']); // ascending
  });

  it('A7: oldGpPct / newGpPct null values are preserved faithfully', () => {
    const recordsWithNull: GpAlertRecord[] = [
      {
        recipeName: 'Mojito', recipeId: 'm1',
        ingredientName: 'Rum', oldGpPct: null, newGpPct: null, createdAtMs: DATE_JAN01,
      },
      {
        recipeName: 'Mojito', recipeId: 'm1',
        ingredientName: 'Mint', oldGpPct: 60, newGpPct: null, createdAtMs: DATE_JAN15,
      },
    ];
    const result = aggregateGpTrend('mojito', recordsWithNull);
    expect(result.found).toBe(true);
    expect(result.events[0].oldGpPct).toBeNull();
    expect(result.events[0].newGpPct).toBeNull();
    expect(result.events[1].oldGpPct).toBe(60);
    expect(result.events[1].newGpPct).toBeNull();
  });

  it('A8: exact full-name match returns found:true with all events', () => {
    const result = aggregateGpTrend('Classic Negroni', RECORDS);
    expect(result.found).toBe(true);
    expect(result.recipeName).toBe('Classic Negroni');
    expect(result.events).toHaveLength(2);
  });

  it('A9: only the matched recipe\'s events are returned — other recipes excluded', () => {
    const result = aggregateGpTrend('negroni', RECORDS);
    // Dry Martini events must not appear
    const vermouth = result.events.find(e => e.ingredientName === 'Vermouth');
    expect(vermouth).toBeUndefined();
  });

  it('A10: date field is YYYY-MM-DD UTC (not a full ISO timestamp)', () => {
    const result = aggregateGpTrend('negroni', RECORDS);
    for (const ev of result.events) {
      expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
