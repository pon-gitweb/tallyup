/**
 * Tests for the Stage-4 Suitee tool: get_batch_ratio_consistency.
 *
 * aggregateBatchRatioConsistency(recipes, velocitiesByProductId, topN, threshold)
 *   → BatchRatioResult
 *
 * Pure aggregation: for each recipe with ≥2 velocity-trackable ingredients,
 * computes each ingredient's implied-serves-per-week from stock depletion velocity
 * (same unit-conversion logic as the pour-variance section ~lines 4423-4435 of api.ts),
 * finds the median across scoreable ingredients, and expresses each ingredient's
 * deviation from that median as variancePercent.
 * Recipes where any ingredient exceeds ±20% deviation → ratioConsistent: false.
 * Sorted by max |variancePercent| descending, capped at topN.
 *
 * Hand-verification of fixtures
 * ──────────────────────────────
 * All ml fixtures: implied = (avgVelocity × packSizeMl) / specQty_ml
 *
 * Recipe "Negroni" — 3 ml ingredients, packSizeMl=500, specQty=25ml each:
 *   Gin     velocity avg=3:   implied = (3 × 500) / 25 = 60 serves/week
 *   Vermouth velocity avg=4:  implied = (4 × 500) / 25 = 80 serves/week
 *   Campari  velocity avg=5:  implied = (5 × 500) / 25 = 100 serves/week
 *   Sorted: [60, 80, 100], median (odd, n=3) = sorted[1] = 80
 *   Gin:     (60 - 80) / 80 × 100 = -25%
 *   Vermouth: (80 - 80) / 80 × 100 =   0%
 *   Campari: (100 - 80) / 80 × 100 =  25%
 *   max |var| = 25% > 20% → ratioConsistent: false
 *
 * Recipe "Balanced" — 3 ml ingredients, packSizeMl=500, specQty=25ml each:
 *   Soda  velocity avg=3.4:  implied = (3.4 × 500) / 25 = 68 serves/week
 *   Juice velocity avg=4:    implied = (4 × 500) / 25 = 80 serves/week
 *   Syrup velocity avg=4.6:  implied = (4.6 × 500) / 25 = 92 serves/week
 *   Sorted: [68, 80, 92], median = 80
 *   Soda:  (68 - 80) / 80 × 100 = -15%
 *   Juice: (80 - 80) / 80 × 100 =   0%
 *   Syrup: (92 - 80) / 80 × 100 =  15%
 *   max |var| = 15% ≤ 20% → ratioConsistent: true
 *
 * Sort order: Negroni (max 25%) before Balanced (max 15%).
 *
 * Even-median fixture (2 ingredients):
 *   P1 implied=60, P2 implied=100
 *   Median (even, n=2) = (60 + 100) / 2 = 80
 *   P1: (60 - 80) / 80 × 100 = -25%, P2: 25%
 *   ratioConsistent: false
 */

import { aggregateBatchRatioConsistency, BatchRecipe } from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPES: BatchRecipe[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    items: [
      { productId: 'soda-id',    productName: 'Soda',    qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      { productId: 'juice-id',   productName: 'Juice',   qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      { productId: 'syrup-id',   productName: 'Syrup',   qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
    ],
  },
  {
    id: 'negroni',
    name: 'Negroni',
    items: [
      { productId: 'gin-id',      productName: 'Gin',      qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      { productId: 'vermouth-id', productName: 'Vermouth', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      { productId: 'campari-id',  productName: 'Campari',  qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
    ],
  },
];

const VELOCITIES = new Map<string, number[]>([
  ['soda-id',    [3.4, 3.4]],
  ['juice-id',   [4, 4]],
  ['syrup-id',   [4.6, 4.6]],
  ['gin-id',     [3, 3]],
  ['vermouth-id',[4, 4]],
  ['campari-id', [5, 5]],
]);

// ── Suite A: aggregateBatchRatioConsistency — core correctness ────────────────

describe('aggregateBatchRatioConsistency — core correctness', () => {

  it('A1: hand-verified variancePercents — Negroni has 25%/-25%/0%, Balanced has 15%/-15%/0%', () => {
    const result = aggregateBatchRatioConsistency(RECIPES, VELOCITIES);

    expect(result.hasData).toBe(true);
    expect(result.recipes).toHaveLength(2);

    // Negroni first (max |var| = 25% > Balanced's 15%)
    const negroni = result.recipes[0];
    expect(negroni.recipeName).toBe('Negroni');
    expect(negroni.ratioConsistent).toBe(false);

    const gin     = negroni.ingredients.find(i => i.productName === 'Gin')!;
    const vermouth = negroni.ingredients.find(i => i.productName === 'Vermouth')!;
    const campari  = negroni.ingredients.find(i => i.productName === 'Campari')!;

    // Gin: (60-80)/80*100 = -25
    expect(gin.variancePercent).toBe(-25);
    // Vermouth: (80-80)/80*100 = 0
    expect(vermouth.variancePercent).toBe(0);
    // Campari: (100-80)/80*100 = 25
    expect(campari.variancePercent).toBe(25);

    // Balanced second (max |var| = 15%)
    const balanced = result.recipes[1];
    expect(balanced.recipeName).toBe('Balanced');
    expect(balanced.ratioConsistent).toBe(true);

    const soda  = balanced.ingredients.find(i => i.productName === 'Soda')!;
    const juice = balanced.ingredients.find(i => i.productName === 'Juice')!;
    const syrup = balanced.ingredients.find(i => i.productName === 'Syrup')!;

    // Soda: (68-80)/80*100 = -15
    expect(soda.variancePercent).toBe(-15);
    // Juice: 0
    expect(juice.variancePercent).toBe(0);
    // Syrup: (92-80)/80*100 = 15
    expect(syrup.variancePercent).toBe(15);
  });

  it('A2: ratioConsistent:false when max |variancePercent| exceeds 20%', () => {
    const result = aggregateBatchRatioConsistency(RECIPES, VELOCITIES);
    const negroni = result.recipes.find(r => r.recipeName === 'Negroni')!;
    expect(negroni.ratioConsistent).toBe(false); // 25% > 20%
  });

  it('A3: ratioConsistent:true when max |variancePercent| does not exceed 20%', () => {
    const result = aggregateBatchRatioConsistency(RECIPES, VELOCITIES);
    const balanced = result.recipes.find(r => r.recipeName === 'Balanced')!;
    expect(balanced.ratioConsistent).toBe(true); // 15% ≤ 20%
  });

  it('A4: sorted by max |variancePercent| descending — most divergent recipe first', () => {
    const result = aggregateBatchRatioConsistency(RECIPES, VELOCITIES);
    expect(result.recipes[0].recipeName).toBe('Negroni');   // max 25%
    expect(result.recipes[1].recipeName).toBe('Balanced');  // max 15%
  });

  it('A5: recipe with only 1 scoreable ingredient is excluded (no ratio to compare)', () => {
    const oneScoreable: BatchRecipe[] = [{
      id: 'solo',
      name: 'Solo',
      items: [
        { productId: 'tracked-id',   productName: 'Tracked',   qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
        { productId: 'untracked-id', productName: 'Untracked', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      ],
    }];
    // Only 'tracked-id' has velocity data — 'untracked-id' has none.
    const vel = new Map<string, number[]>([['tracked-id', [3]]]);
    const result = aggregateBatchRatioConsistency(oneScoreable, vel);
    expect(result.hasData).toBe(false);
    expect(result.recipes).toHaveLength(0);
  });

  it('A6: all velocities empty or zero → hasData:false (no completed stocktake cycles)', () => {
    const vel = new Map<string, number[]>([
      ['gin-id',     []],    // no cycles at all
      ['vermouth-id',[0]],   // cycle yielded zero velocity
      ['campari-id', [0, 0]],
    ]);
    const result = aggregateBatchRatioConsistency(RECIPES, vel);
    expect(result.hasData).toBe(false);
    expect(result.recipes).toHaveLength(0);
  });

  it('A7: ingredient missing productId is skipped without crashing', () => {
    const nullIdRecipe: BatchRecipe[] = [{
      id: 'r',
      name: 'NullId',
      items: [
        { productId: null,      productName: 'Mystery',  qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
        { productId: 'gin-id',  productName: 'Gin',      qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
        { productId: 'campari-id', productName: 'Campari', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      ],
    }];
    const vel = new Map<string, number[]>([
      ['gin-id',    [3]],
      ['campari-id',[5]],
    ]);
    // Mystery skipped (no productId), Gin and Campari are scoreable (2 ingredients → OK)
    const result = aggregateBatchRatioConsistency(nullIdRecipe, vel);
    expect(result.hasData).toBe(true);
    expect(result.recipes[0].ingredients).toHaveLength(2);
    // No 'Mystery' ingredient in output
    expect(result.recipes[0].ingredients.find(i => i.productName === 'Mystery')).toBeUndefined();
  });

  it('A8: "each" unit — no packSize needed; implied = velocity / qty', () => {
    // Two "each" ingredients — confirms the unit-conversion branch works for discrete items.
    const eachRecipe: BatchRecipe[] = [{
      id: 'each-r',
      name: 'Each Recipe',
      items: [
        { productId: 'can-id',    productName: 'Can',    qty: 1, unit: 'each', packSizeMl: null, packSizeG: null },
        { productId: 'sachet-id', productName: 'Sachet', qty: 2, unit: 'ea',   packSizeMl: null, packSizeG: null },
      ],
    }];
    const vel = new Map<string, number[]>([
      ['can-id',    [10]],   // implied = 10/1 = 10
      ['sachet-id', [24]],   // implied = 24/2 = 12
    ]);
    // median([10,12]) = (10+12)/2 = 11
    // varCan    = (10-11)/11*100 = -9.09
    // varSachet = (12-11)/11*100 =  9.09
    // Both within 20% → ratioConsistent: true
    const result = aggregateBatchRatioConsistency(eachRecipe, vel);
    expect(result.hasData).toBe(true);
    expect(result.recipes[0].ratioConsistent).toBe(true);
    expect(result.recipes[0].ingredients).toHaveLength(2);
  });

  it('A9: even-count ingredient list — median is average of middle two values', () => {
    // 2 ingredients: implied [60, 100], median = (60+100)/2 = 80
    // var60 = (60-80)/80*100 = -25%, var100 = 25%
    const recipe: BatchRecipe[] = [{
      id: 'two-r',
      name: 'TwoIngredient',
      items: [
        { productId: 'p1', productName: 'Slow', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
        { productId: 'p2', productName: 'Fast', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      ],
    }];
    const vel = new Map<string, number[]>([
      ['p1', [3]],  // implied = (3*500)/25 = 60
      ['p2', [5]],  // implied = (5*500)/25 = 100
    ]);
    const result = aggregateBatchRatioConsistency(recipe, vel);
    expect(result.hasData).toBe(true);
    const [slow, fast] = [
      result.recipes[0].ingredients.find(i => i.productName === 'Slow')!,
      result.recipes[0].ingredients.find(i => i.productName === 'Fast')!,
    ];
    expect(slow.variancePercent).toBe(-25);
    expect(fast.variancePercent).toBe(25);
    expect(result.recipes[0].ratioConsistent).toBe(false);
  });

  it('A10: topN cap — more than 5 qualifying recipes returns only top 5 (by max |var|)', () => {
    // Build 6 identical recipes each with 2 ingredients but varying drift.
    const manyRecipes: BatchRecipe[] = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      name: `Recipe${i}`,
      items: [
        { productId: `slow-${i}`, productName: 'Slow', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
        { productId: `fast-${i}`, productName: 'Fast', qty: 25, unit: 'ml', packSizeMl: 500, packSizeG: null },
      ],
    }));
    // Give each a different spread so they sort distinctly
    const vel = new Map<string, number[]>(
      manyRecipes.flatMap((r, i) => [
        [`slow-${i}`, [(i + 1) * 1]],   // velocity proportional to index
        [`fast-${i}`, [(i + 1) * 2]],
      ]),
    );
    const result = aggregateBatchRatioConsistency(manyRecipes, vel);
    expect(result.recipes.length).toBeLessThanOrEqual(5);
  });

  it('A11: ml ingredient missing packSizeMl is skipped — reduces scoreable count', () => {
    // Only Gin has packSizeMl; Vermouth lacks it → only 1 scoreable → recipe excluded.
    const recipe: BatchRecipe[] = [{
      id: 'r',
      name: 'MissingPack',
      items: [
        { productId: 'gin-id',     productName: 'Gin',     qty: 25, unit: 'ml', packSizeMl: 500,        packSizeG: null },
        { productId: 'mystery-id', productName: 'Mystery', qty: 25, unit: 'ml', packSizeMl: null,       packSizeG: null },
      ],
    }];
    const vel = new Map<string, number[]>([
      ['gin-id',     [3]],
      ['mystery-id', [3]],
    ]);
    const result = aggregateBatchRatioConsistency(recipe, vel);
    expect(result.hasData).toBe(false); // only 1 scoreable ingredient
  });
});
