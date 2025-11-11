// @ts-nocheck
import { deleteDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Deletes a recipe only if it is a draft.
 */
export async function deleteDraft(venueId: string, recipeId: string) {
  if (!venueId) throw new Error('venueId required');
  if (!recipeId) throw new Error('recipeId required');

  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Recipe not found');
  const status = (snap.data()?.status || 'draft');

  if (status !== 'draft') {
    throw new Error('Only drafts can be deleted');
  }
  await deleteDoc(ref);
  return { ok: true };
}
