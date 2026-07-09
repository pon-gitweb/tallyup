/**
 * Tests for Hosti Health score calculation logic.
 * Extracted from hostiHealth.ts — tests the weighted redistribution algorithm
 * to ensure null KPIs don't inflate or deflate the composite score.
 */

// Inline the pure score calculation logic so we can test it without Firestore
function calculateCompositeScore(
  kpis: Record<string, number | null>,
  weights: Record<string, number>
): number {
  const available = Object.entries(kpis).filter(([, v]) => v !== null) as [string, number][];
  const totalWeight = available.reduce((s, [k]) => s + (weights[k] ?? 0), 0);
  if (available.length === 0 || totalWeight === 0) return 0;
  return Math.round(
    available.reduce((s, [k, v]) => s + (v * (weights[k] ?? 0) / totalWeight), 0)
  );
}

const DEFAULT_WEIGHTS = {
  stockAccuracy: 0.35,
  labourEfficiency: 0.24,
  inventoryHealth: 0.24,
  orderingIntelligence: 0.17,
  wasteControl: 0.00, // excluded when null — weight redistributed
};

describe('Hosti Health score calculation', () => {
  it('returns 0 when all KPIs are null', () => {
    const kpis = { stockAccuracy: null, labourEfficiency: null, inventoryHealth: null, orderingIntelligence: null, wasteControl: null };
    expect(calculateCompositeScore(kpis, DEFAULT_WEIGHTS)).toBe(0);
  });

  it('returns correct score when all KPIs are present', () => {
    const kpis = { stockAccuracy: 80, labourEfficiency: 70, inventoryHealth: 90, orderingIntelligence: 60, wasteControl: null };
    const weights = { stockAccuracy: 0.35, labourEfficiency: 0.24, inventoryHealth: 0.24, orderingIntelligence: 0.17, wasteControl: 0 };
    const score = calculateCompositeScore(kpis, weights);
    // 80*0.35 + 70*0.24 + 90*0.24 + 60*0.17 = 28 + 16.8 + 21.6 + 10.2 = 76.6 → 77
    expect(score).toBe(77);
  });

  it('redistributes weight correctly when a KPI is null', () => {
    // labourEfficiency null — its 0.24 weight redistributes to others
    const kpis = { stockAccuracy: 100, labourEfficiency: null, inventoryHealth: 100, orderingIntelligence: 100, wasteControl: null };
    const weights = { stockAccuracy: 0.35, labourEfficiency: 0.24, inventoryHealth: 0.24, orderingIntelligence: 0.17, wasteControl: 0 };
    const score = calculateCompositeScore(kpis, weights);
    expect(score).toBe(100); // all available KPIs are 100 → score must be 100
  });

  it('a null KPI does not inflate the score', () => {
    // If wasteControl (null) were counted as 100, score would be higher than it should be
    const kpisWithout = { stockAccuracy: 60, labourEfficiency: 60, inventoryHealth: 60, orderingIntelligence: 60, wasteControl: null };
    const kpisWith    = { stockAccuracy: 60, labourEfficiency: 60, inventoryHealth: 60, orderingIntelligence: 60, wasteControl: 100 };
    const weights = { stockAccuracy: 0.30, labourEfficiency: 0.20, inventoryHealth: 0.20, orderingIntelligence: 0.15, wasteControl: 0.15 };
    const scoreWithout = calculateCompositeScore(kpisWithout, weights);
    const scoreWith    = calculateCompositeScore(kpisWith, weights);
    expect(scoreWith).toBeGreaterThan(scoreWithout); // wasteControl=100 should improve score
    expect(scoreWithout).toBe(60); // null KPI redistributes — 60×all = 60
  });

  it('score is always between 0 and 100', () => {
    const cases = [
      { stockAccuracy: 0,   labourEfficiency: 0,    inventoryHealth: 0,    orderingIntelligence: 0,    wasteControl: null },
      { stockAccuracy: 100, labourEfficiency: 100,   inventoryHealth: 100,  orderingIntelligence: 100,  wasteControl: 100  },
      { stockAccuracy: 50,  labourEfficiency: null,  inventoryHealth: null, orderingIntelligence: null, wasteControl: null },
    ];
    const weights = { stockAccuracy: 0.35, labourEfficiency: 0.24, inventoryHealth: 0.24, orderingIntelligence: 0.17, wasteControl: 0 };
    cases.forEach(kpis => {
      const score = calculateCompositeScore(kpis, weights);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  it('single KPI present returns that KPI value', () => {
    const kpis = { stockAccuracy: 73, labourEfficiency: null, inventoryHealth: null, orderingIntelligence: null, wasteControl: null };
    const weights = { stockAccuracy: 0.35, labourEfficiency: 0.24, inventoryHealth: 0.24, orderingIntelligence: 0.17, wasteControl: 0 };
    expect(calculateCompositeScore(kpis, weights)).toBe(73);
  });
});
