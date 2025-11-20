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
 * - Optionally persists a POS link object (posLink) for mapping to POS items/buttons.
 */
export async function confirmRecipe(
  venueId: string,
  recipeId: string,
  payload: {
    name?: string | null;
    yield?: number | null;
    unit?: string | null;
    cogs?: number | null;
    rrp?: number | null;
    method?: string | null;
    gpPct?: number | null;
    rrpIncludesGst?: boolean;
    itemsSnapshot?: any[];   // explicit items from UI parent (unclean)

    // Optional POS linkage (transparent pass-through to the recipe doc)
    posLink?: {
      posItemIds?: string[];      // POS item / PLU IDs this recipe maps to
      posSystem?: string | null;  // e.g. 'Lightspeed', 'SwiftPOS', 'Other'
      notes?: string | null;      // freeform mapping note
    } | null;
  }
) {
  if (!venueId) throw new Error('venueId required');
  if (!recipeId) throw new Error('recipeId required');

  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Recipe not found');

  const data = snap.data() || {};

  // Choose items source:
  // - Prefer explicit snapshot from payload (UI parent)
  // - Fallback to existing doc.items (array or [])
  const rawItems = Array.isArray(payload?.itemsSnapshot)
    ? payload.itemsSnapshot
    : (Array.isArray(data.items) ? data.items : []);

  // Clean snapshot to be Firestore-safe and consistent
  const items = makeFirestoreItemSnapshot(rawItems);

  // Local view used for consumption math only (not written as-is)
  const localRecipe = {
    status: data.status || 'draft',
    mode: data.mode || null,
    items,
    yield: (payload?.yield ?? data?.yield) ?? null,
    portionsPerBatch: (data?.portionsPerBatch ?? null),
  };

  // Normalised consumption per serve (ml / g / each etc.)
  const consumptionPerServe = computeConsumption(localRecipe, 1);

  // Build patch:
  // - Strip undefined values and itemsSnapshot (we store `items` instead)
  // - Allow optional posLink to flow through transparently
  const patch: any = {
    ...Object.fromEntries(
      Object.entries(payload || {}).filter(
        ([key, value]) => value !== undefined && key !== 'itemsSnapshot'
      )
    ),
    status: 'confirmed',
    items,
    consumptionPerServe,
    updatedAt: serverTimestamp(),
  };

  if (__DEV__) {
    try {
      console.log(
        '[confirmRecipe] items:',
        items.length,
        'cons keys:',
        Object.keys(consumptionPerServe || {}).length
      );
      if (patch.posLink) {
        console.log('[confirmRecipe] posLink present:', patch.posLink);
      }
    } catch {}
  }

  await updateDoc(ref, patch);
  return { id: recipeId };
}
