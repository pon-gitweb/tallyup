/**
 * Normalizes confirmed recipe consumption into base units per product.
 * Output map is in ml, g, and each.
 *
 * Accepts flexible recipe shapes:
 * - recipe.status === 'confirmed' (or draft; we just read items)
 * - recipe.items: Array<{ productId?: string, qty?: number, unit?: string }>
 * - recipe.mode in ['single','batch','dish'] (optional)
 * - recipe.yield (number) OR portionsPerBatch (number) when batch
 */

export type ConsumptionBucket = { ml?: number; g?: number; each?: number };
export type ConsumptionMap = Record<string, ConsumptionBucket>;

type RecipeItem = {
  productId?: string | null;
  qty?: number | null;     // quantity as entered in recipe editor (per serve for single; per batch for batch)
  unit?: string | null;    // 'ml'|'l'|'g'|'kg'|'each' (others ignored)
  kind?: string | null;    // optional; e.g., 'misc' or 'product'
};

type RecipeDoc = {
  id?: string;
  status?: 'draft'|'confirmed';
  mode?: 'single'|'batch'|'dish'|string|null;
  yield?: number|null;            // number of serves produced by batch
  portionsPerBatch?: number|null; // alternative field name
  items?: RecipeItem[] | null;
};

function toBaseMl(qty: number, unit?: string|null): number|null {
  if (!Number.isFinite(qty)) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'ml') return qty;
  if (u === 'l' || u === 'lt' || u === 'liter' || u === 'litre') return qty * 1000;
  // common bar units
  if (u === 'cl') return qty * 10;     // centilitre
  if (u === 'dl') return qty * 100;    // decilitre
  return null;
}
function toBaseG(qty: number, unit?: string|null): number|null {
  if (!Number.isFinite(qty)) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'g' || u === 'gram') return qty;
  if (u === 'kg' || u === 'kilogram') return qty * 1000;
  return null;
}
function isEach(unit?: string|null): boolean {
  const u = (unit || '').toLowerCase();
  return u === 'each' || u === 'ea' || u === 'unit' || u === 'count' || u === '';
}

/**
 * Compute a normalized map of product consumption in base units for a given number of serves.
 * - For single/dish recipes: item.qty is treated as per-serve.
 * - For batch recipes: item.qty is per-batch; divided by recipe yield to get per-serve.
 */
export function computeConsumption(recipe: RecipeDoc, serves: number): ConsumptionMap {
  const out: ConsumptionMap = {};
  if (!recipe || !Array.isArray(recipe.items) || serves <= 0) return out;

  // Determine per-serve divisor for batch recipes
  const isBatch = (String(recipe.mode || '')).toLowerCase() === 'batch';
  const batchServes =
    (Number(recipe.yield ?? NaN) && Number(recipe.yield)) ||
    (Number(recipe.portionsPerBatch ?? NaN) && Number(recipe.portionsPerBatch)) ||
    null;

  const perServeDivisor = isBatch
    ? (batchServes && batchServes > 0 ? batchServes : null)
    : 1; // single/dish treated as per-serve already

  for (const item of recipe.items) {
    const productId = (item?.productId || '').trim();
    if (!productId) continue;                // ignore misc / unlinked lines
    const rawQty = Number(item?.qty ?? NaN);
    if (!Number.isFinite(rawQty) || rawQty <= 0) continue;

    // convert to per-serve qty
    const perServeQty = isBatch
      ? (perServeDivisor ? rawQty / perServeDivisor : null)
      : rawQty;

    if (perServeQty == null || perServeQty <= 0) continue;

    // total for requested serves
    const totalQty = perServeQty * serves;

    // route by unit
    const unit = item?.unit || '';
    const ml = toBaseMl(totalQty, unit);
    const g  = toBaseG(totalQty, unit);
    const ea = isEach(unit) ? totalQty : null;

    if (ml == null && g == null && ea == null) {
      // Unknown unit; ignore safely
      continue;
    }

    // aggregate
    const bucket = out[productId] || {};
    if (ml != null) bucket.ml = (bucket.ml ?? 0) + ml;
    if (g  != null) bucket.g  = (bucket.g  ?? 0) + g;
    if (ea != null) bucket.each = (bucket.each ?? 0) + ea;
    out[productId] = bucket;
  }

  return out;
}

/**
 * Convenience: per-serve map (i.e., serves = 1).
 * - For batch mode, this uses recipe.yield/portionsPerBatch to divide per-serve.
 * - For single/dish, this is the item qty itself normalized to base units.
 */
export function computePerServeMap(recipe: RecipeDoc): ConsumptionMap {
  return computeConsumption(recipe, 1);
}
