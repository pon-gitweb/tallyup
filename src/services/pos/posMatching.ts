// @ts-nocheck
import { matchProductInList } from '../matching';
import type { POSSaleItem } from './POSService';

export type MatchSuggestion = {
  type: 'product' | 'recipe' | 'none';
  productId?: string;
  productName?: string;
  recipeId?: string;
  recipeName?: string;
  confidence: 'high' | 'medium' | 'low';
};

// Same normalization as matching.ts — kept local so posMatching has no hidden dep on
// unexported internals of that module.
function normName(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter(Boolean));
  const tb = new Set(normName(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / new Set([...ta, ...tb]).size;
}

export function suggestMatch(
  posItem: POSSaleItem,
  venueProducts: Array<{ id: string; name: string; category?: string }>,
  venueRecipes: Array<{ id: string; name: string }>,
): MatchSuggestion {
  // 1. Recipes first — cocktails / mixed drinks are almost always recipe-type sales.
  let bestRecipe: (typeof venueRecipes)[0] | null = null;
  let bestRecipeScore = 0;
  for (const r of venueRecipes) {
    const score = tokenJaccard(posItem.posItemName, r.name);
    if (score > bestRecipeScore) { bestRecipeScore = score; bestRecipe = r; }
  }
  if (bestRecipe && bestRecipeScore >= 0.5) {
    const isExact = normName(posItem.posItemName) === normName(bestRecipe.name);
    return {
      type: 'recipe',
      recipeId: bestRecipe.id,
      recipeName: bestRecipe.name,
      confidence: isExact || bestRecipeScore >= 0.8 ? 'high' : 'medium',
    };
  }

  // 2. Direct products — delegates to the shared matching service which handles
  //    exact-barcode → exact-name → fuzzy token-Jaccard in one call.
  const result = matchProductInList(venueProducts as any, { name: posItem.posItemName });
  if (result.match && result.confidence > 0) {
    return {
      type: 'product',
      productId: result.match.id,
      productName: result.match.name,
      confidence: result.confidence >= 0.9 ? 'high' : result.confidence >= 0.6 ? 'medium' : 'low',
    };
  }

  return { type: 'none', confidence: 'low' };
}
