/**
 * Tests for the Stage-2 Suitee tool: get_worst_gp_recipes.
 *
 * aggregateWorstGpRecipes(recipes, topN) → WorstGpRecipeResult
 *   Pure aggregation: computes GP% via computeRecipeGpPct for each recipe that has
 *   both rrp and cogs, sorts ascending (worst GP% first), caps at topN.
 *   Recipes missing either field are excluded — not scored as 0%.
 *
 * Hand-verification of fixtures
 * ─────────────────────────────
 * computeRecipeGpPct(rrp, cogs) = round2(((rrp - cogs) / rrp) * 100)
 * where round2(n) = Math.round(n * 100) / 100
 *
 * "House Wine"       rrp=10, cogs=8  → round2((2/10)*100)   = round2(20.0)    = 20
 * "Aperol Spritz"    rrp=15, cogs=6  → round2((9/15)*100)   = round2(60.0)    = 60
 * "Classic Negroni"  rrp=20, cogs=4  → round2((16/20)*100)  = round2(80.0)    = 80
 * "Espresso Martini" rrp=18, cogs=3  → round2((15/18)*100)  = round2(83.333…) = 83.33
 * "Mystery Cocktail" rrp=null, cogs=3 → excluded (null rrp)
 * "Water Kefir"      rrp=8, cogs=null → excluded (null cogs)
 *
 * Sorted ascending (worst first): House Wine(20), Aperol Spritz(60),
 *   Classic Negroni(80), Espresso Martini(83.33)
 * excludedCount = 2
 */

import { aggregateWorstGpRecipes, SuiteeRecipe } from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPES: SuiteeRecipe[] = [
  { name: 'House Wine',       rrp: 10,   cogs: 8    },  // GP 20%    ← worst
  { name: 'Aperol Spritz',    rrp: 15,   cogs: 6    },  // GP 60%
  { name: 'Classic Negroni',  rrp: 20,   cogs: 4    },  // GP 80%
  { name: 'Espresso Martini', rrp: 18,   cogs: 3    },  // GP 83.33% ← best
  { name: 'Mystery Cocktail', rrp: null, cogs: 3    },  // excluded — no rrp
  { name: 'Water Kefir',      rrp: 8,    cogs: null },  // excluded — no cogs
];

// ── Suite A: aggregateWorstGpRecipes — ranking correctness ────────────────────

describe('aggregateWorstGpRecipes — ranking correctness', () => {

  it('A1: hand-verified order — worst GP% first, correct values', () => {
    const result = aggregateWorstGpRecipes(RECIPES, 10);

    expect(result.hasData).toBe(true);
    expect(result.recipes).toHaveLength(4); // 4 rankable recipes

    const [worst, second, third, best] = result.recipes;

    expect(worst.recipeName).toBe('House Wine');
    expect(worst.gpPercent).toBe(20);       // round2((2/10)*100) = 20
    expect(worst.rrp).toBe(10);
    expect(worst.cogs).toBe(8);

    expect(second.recipeName).toBe('Aperol Spritz');
    expect(second.gpPercent).toBe(60);      // round2((9/15)*100) = 60

    expect(third.recipeName).toBe('Classic Negroni');
    expect(third.gpPercent).toBe(80);       // round2((16/20)*100) = 80

    expect(best.recipeName).toBe('Espresso Martini');
    expect(best.gpPercent).toBe(83.33);     // round2((15/18)*100) = 83.33
  });

  it('A2: missing cogs → excluded from recipes, counted in excludedCount', () => {
    const result = aggregateWorstGpRecipes(RECIPES, 10);

    // "Water Kefir" (cogs=null) must NOT appear in recipes
    expect(result.recipes.find(r => r.recipeName === 'Water Kefir')).toBeUndefined();

    // Excluded count includes both the null-cogs and null-rrp entries
    expect(result.excludedCount).toBe(2);
  });

  it('A3: missing rrp → excluded from recipes, counted in excludedCount', () => {
    const result = aggregateWorstGpRecipes(RECIPES, 10);
    expect(result.recipes.find(r => r.recipeName === 'Mystery Cocktail')).toBeUndefined();
    expect(result.excludedCount).toBe(2);
  });

  it('A4: recipe with rrp <= 0 is excluded (computeRecipeGpPct returns null)', () => {
    const withZeroRrp: SuiteeRecipe[] = [
      { name: 'Free Sample', rrp: 0,  cogs: 1 },   // rrp=0 → null from function
      { name: 'Negative',    rrp: -5, cogs: 1 },   // rrp<0 → null from function
      { name: 'Valid',       rrp: 10, cogs: 3 },
    ];
    const result = aggregateWorstGpRecipes(withZeroRrp, 5);
    expect(result.hasData).toBe(true);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].recipeName).toBe('Valid');
    expect(result.excludedCount).toBe(2);
  });

  it('A5: topN cap — 4 rankable recipes, topN=2 returns the 2 worst', () => {
    const result = aggregateWorstGpRecipes(RECIPES, 2);
    expect(result.hasData).toBe(true);
    expect(result.recipes).toHaveLength(2);
    // First two are the worst: House Wine then Aperol Spritz
    expect(result.recipes[0].recipeName).toBe('House Wine');
    expect(result.recipes[1].recipeName).toBe('Aperol Spritz');
    // excludedCount still reflects the full set of excluded recipes
    expect(result.excludedCount).toBe(2);
  });

  it('A6: empty input → hasData:false, recipes:[], excludedCount:0', () => {
    const result = aggregateWorstGpRecipes([], 5);
    expect(result.hasData).toBe(false);
    expect(result.recipes).toHaveLength(0);
    expect(result.excludedCount).toBe(0);
  });

  it('A7: all recipes missing data → hasData:false, excludedCount equals input length', () => {
    const allMissing: SuiteeRecipe[] = [
      { name: 'No RRP',  rrp: null, cogs: 3 },
      { name: 'No Cogs', rrp: 15,   cogs: null },
    ];
    const result = aggregateWorstGpRecipes(allMissing, 5);
    expect(result.hasData).toBe(false);
    expect(result.recipes).toHaveLength(0);
    expect(result.excludedCount).toBe(2);
  });

  it('A8: excludedCount persists when topN trims the returned list', () => {
    // Even if topN cuts the recipes array, excludedCount must still reflect
    // the total number excluded from the full input — not just from the top slice.
    const result = aggregateWorstGpRecipes(RECIPES, 1);
    expect(result.recipes).toHaveLength(1);
    expect(result.excludedCount).toBe(2); // 2 excluded regardless of topN
  });
});
