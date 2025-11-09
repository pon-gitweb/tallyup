import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { RecipeItem } from '../../types/recipes';

export type RecipeDraftPatch = {
  name?: string|null;
  items?: RecipeItem[];
  // single/dish
  yield?: number|null;
  unit?: string|null;
  // batch
  portionSize?: number|null;
  portionUnit?: string|null;
  // derived money
  cogs?: number|null;
  rrp?: number|null;
  targetGpPct?: number|null;
  // notes
  method?: string|null;
};

export async function updateRecipeDraft(venueId: string, recipeId: string, patch: RecipeDraftPatch) {
  if (!venueId) throw new Error('Missing venueId');
  if (!recipeId) throw new Error('Missing recipeId');
  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  return { ok: true };
}
