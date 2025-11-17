// @ts-nocheck
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

/**
 * Shape of what we store on the recipe doc (minimal, tolerant of older docs).
 * We don't enforce a strict schema here to avoid breaking existing data.
 */
export type RecipeConsumptionResult = {
  recipeId: string;
  venueId: string;
  name: string | null;
  status: string | null;
  mode: string | null;
  yield: number | null;
  unit: string | null;
  /**
   * Whatever confirmRecipe wrote as `consumptionPerServe`.
   * Typically this is a map keyed by productId, with ml/g/each etc.
   */
  consumptionPerServe: any | null;
  /**
   * Optional POS linkage object, if present on the recipe doc.
   * We keep it as-is so POS adapters can interpret it.
   */
  posLink?: any | null;
};

/**
 * Fetch a single recipe's normalized consumption snapshot.
 *
 * This is the main entry point for:
 *  - Stock / variance explainers
 *  - Suggested orders
 *  - Reports that need "usage per serve" from recipes.
 *
 * It does NOT compute anything; it only reads what confirmRecipe already stored.
 */
export async function getRecipeConsumption(params: {
  venueId: string;
  recipeId: string;
}): Promise<RecipeConsumptionResult | null> {
  const { venueId, recipeId } = params;
  if (!venueId) throw new Error('venueId is required');
  if (!recipeId) throw new Error('recipeId is required');

  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    if (__DEV__) {
      try { console.log('[getRecipeConsumption] recipe not found', { venueId, recipeId }); } catch {}
    }
    return null;
  }

  const data: any = snap.data() || {};

  const result: RecipeConsumptionResult = {
    recipeId: snap.id,
    venueId,
    name: (data.name ?? null) as string | null,
    status: (data.status ?? null) as string | null,
    mode: (data.mode ?? null) as string | null,
    yield: (typeof data.yield === 'number' ? data.yield : null),
    unit: (data.unit ?? null) as string | null,
    consumptionPerServe: data.consumptionPerServe ?? null,
    posLink: data.posLink ?? null,
  };

  return result;
}
