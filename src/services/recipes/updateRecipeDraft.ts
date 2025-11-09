import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export type RecipeDraftPatch = {
  name?: string | null;
  yield?: number | null;
  unit?: string | null;
  items?: any[];               // inline ingredients
  cogs?: number | null;        // derived, persisted
  rrp?: number | null;         // sell price
  gpTarget?: number | null;    // %
  method?: string | null;
  status?: 'draft' | 'confirmed';
  category?: 'food' | 'beverage' | null;
  mode?: 'batch' | 'single' | 'dish' | null;
};

export async function updateRecipeDraft(venueId: string, recipeId: string, patch: RecipeDraftPatch) {
  if (!venueId) throw new Error('Missing venueId');
  if (!recipeId) throw new Error('Missing recipeId');
  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  return { ok: true };
}
