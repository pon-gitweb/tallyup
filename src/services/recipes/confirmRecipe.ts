// @ts-nocheck
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { computeConsumption } from './consumption';
import { makeFirestoreItemSnapshot } from './itemSnapshot';

/**
 * Confirm a recipe (stable, controlled):
 * - Freezes the explicit items snapshot if provided; else uses doc.items (array or []).
 * - Cleans snapshot to be Firestore-safe.
 * - Computes per-serve normalized consumption from the snapshot and yield.
 */
export async function confirmRecipe(
  venueId: string,
  recipeId: string,
  payload: {
    name?: string|null;
    yield?: number|null;
    unit?: string|null;
    cogs?: number|null;
    rrp?: number|null;
    method?: string|null;
    gpPct?: number|null;
    rrpIncludesGst?: boolean;
    itemsSnapshot?: any[];   // explicit items from UI parent (unclean)
  }
) {
  if (!venueId) throw new Error('venueId required');
  if (!recipeId) throw new Error('recipeId required');

  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Recipe not found');

  const data = snap.data() || {};
  const rawItems = Array.isArray(payload?.itemsSnapshot)
    ? payload.itemsSnapshot
    : (Array.isArray(data.items) ? data.items : []);
  const items = makeFirestoreItemSnapshot(rawItems);

  const localRecipe = {
    status: data.status || 'draft',
    mode: data.mode || null,
    items,
    yield: (payload?.yield ?? data?.yield) ?? null,
    portionsPerBatch: (data?.portionsPerBatch ?? null)
  };

  const consumptionPerServe = computeConsumption(localRecipe, 1);

  const patch: any = {
    ...Object.fromEntries(Object.entries(payload || {}).filter(([k, v]) => v !== undefined && k !== 'itemsSnapshot')),
    status: 'confirmed',
    items,
    consumptionPerServe,
    updatedAt: serverTimestamp(),
  };

  if (__DEV__) {
    try { console.log('[confirmRecipe] items:', items.length, 'cons keys:', Object.keys(consumptionPerServe||{}).length); } catch {}
  }

  await updateDoc(ref, patch);
  return { id: recipeId };
}
