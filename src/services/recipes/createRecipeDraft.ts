import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { RecipeCategory, RecipeMode, RecipeDoc } from '../../types/recipes';

export type RecipeDraftInput = {
  venueId: string;
  name: string;                         // entered in Craft-It screen
  category: RecipeCategory | null;      // food | beverage
  mode: RecipeMode | null;              // single | batch | dish
};

export async function createRecipeDraft({ venueId, name, category, mode }: RecipeDraftInput) {
  if (!venueId) throw new Error('Missing venueId');
  if (!name || !name.trim()) throw new Error('Please enter a recipe name');

  const isSingleLike = mode === 'single' || mode === 'dish';

  const payload: Partial<RecipeDoc> = {
    name: name.trim(),
    status: 'draft',
    category,
    mode,
    yield: isSingleLike ? 1 : null,
    unit: isSingleLike ? 'serve' : null,
    items: [],
    cogs: null,
    rrp: null,
    targetGpPct: 0.65,              // default 65% GP; adjust later
    portionSize: null,              // batch-only; user sets later
    portionUnit: null,
    method: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, 'venues', venueId, 'recipes'), payload);
  return { id: docRef.id };
}
