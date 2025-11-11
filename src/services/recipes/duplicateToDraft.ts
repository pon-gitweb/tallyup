// @ts-nocheck
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Duplicate a recipe (usually confirmed) to a new DRAFT copy.
 * Copies common fields + items; writes status='draft'.
 * Returns the new draft id.
 */
export async function duplicateToDraft(venueId: string, recipeId: string) {
  if (!venueId) throw new Error('venueId required');
  if (!recipeId) throw new Error('recipeId required');

  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Recipe not found');

  const src = snap.data() || {};
  const now = serverTimestamp();

  const payload: any = {
    status: 'draft',
    fromRecipeId: recipeId,

    // name & meta
    name: src?.name ? `${src.name} (copy)` : 'Untitled (copy)',
    category: src?.category ?? null,
    mode: src?.mode ?? null,

    // quantities
    yield: src?.yield ?? null,
    unit: src?.unit ?? null,
    portionSize: src?.portionSize ?? null,
    portionUnit: src?.portionUnit ?? null,

    // pricing + notes
    cogs: typeof src?.cogs === 'number' ? src.cogs : null,
    rrp: typeof src?.rrp === 'number' ? src.rrp : null,
    gpPct: typeof src?.gpPct === 'number' ? src.gpPct : null,
    rrpIncludesGst: !!src?.rrpIncludesGst,
    method: src?.method ?? null,

    // items snapshot (kept as-is)
    items: Array.isArray(src?.items) ? src.items : [],

    createdAt: now,
    updatedAt: now,
  };

  const col = collection(db, 'venues', venueId, 'recipes');
  const newRef = await addDoc(col, payload);
  return { id: newRef.id };
}
