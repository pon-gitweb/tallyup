/**
 * computeConsumption
 * Given a confirmed recipe document and a number of serves used/sold,
 * returns a normalized map of productId -> quantity in native unit (ml|g|each).
 *
 * Assumptions (scaffolding only):
 * - Each item has: type ('product'|'misc'), productId (for 'product'), qty (per serve), unit ('ml'|'g'|'each').
 * - If the recipe is 'batch', qty in items should represent per-serve equivalents at confirm-time (we froze them).
 * - Misc items are ignored for inventory consumption.
 */
export type ConsumptionMap = Record<string, number>;

export function computeConsumption(recipeDoc: any, serves: number): ConsumptionMap {
  const out: ConsumptionMap = {};
  const nServes = Number(serves || 0) || 0;
  if (!recipeDoc || !Array.isArray(recipeDoc.items) || nServes <= 0) return out;

  for (const it of recipeDoc.items) {
    if (!it || it.type === 'misc') continue;
    const productId = it.productId || null;
    if (!productId) continue;

    const perServeQty = Number(it.qty || 0) || 0; // qty per serve in its unit
    const total = perServeQty * nServes;

    if (!out[productId]) out[productId] = 0;
    out[productId] += total; // unit carried implicitly by product
  }

  return out;
}
