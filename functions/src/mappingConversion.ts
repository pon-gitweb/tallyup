/**
 * Pure conversion logic: POS sale units → stock units.
 *
 * Given a posProductMappings document and a product document, computes how
 * many stock units (i.e. whole bottles/packs) correspond to one POS sale unit.
 *
 * Source priority:
 *   1. servingType === 'each'  → 1 : 1 (no size needed)
 *   2. servingMl set           → servingMl / productSizeInMl  (ml base only)
 *   3. conversionRatio set     → legacy user-entered ratio
 *   4. default                 → 1 (no information)
 *
 * Never mixes bases: servingMl against a non-ml product size → 'unconvertible'.
 */

import { parseProductSize } from './productSize'

export type ConversionSource =
  | 'servingMl'
  | 'conversionRatio'
  | 'each'
  | 'default'
  | 'unconvertible'

export type StockUnitsResult = {
  qty: number
  source: ConversionSource
}

export interface MappingDoc {
  servingType?: 'spirit' | 'wine' | 'beer' | 'cocktail' | 'each' | null
  servingMl?: number | null
  conversionRatio?: number | null
  conversionUnit?: string | null
  mappingType?: string | null
  posItemName?: string | null
  productId?: string | null
  recipeId?: string | null
}

export interface ProductDoc {
  id?: string
  name?: string | null
  size?: string | null
  unit?: string | null
}

/**
 * Returns how many stock units (e.g. whole bottles) one POS sale unit
 * represents, plus where the conversion came from.
 */
export function stockUnitsPerSale(
  mapping: MappingDoc,
  product: ProductDoc | null,
): StockUnitsResult {
  // 1. Explicit "each" serving type — 1 POS unit = 1 stock unit
  if (mapping.servingType === 'each') {
    return { qty: 1, source: 'each' }
  }

  // 2. servingMl: portion-size-based conversion
  if (mapping.servingMl != null && mapping.servingMl > 0) {
    const parsed = parseProductSize(product?.size ?? null, product?.unit ?? null)
    if (!parsed || parsed.base !== 'ml') {
      // Product size is unknown or in a different base (g, each) — can't convert
      return { qty: 1, source: 'unconvertible' }
    }
    return { qty: mapping.servingMl / parsed.amount, source: 'servingMl' }
  }

  // 3. Legacy user-entered conversionRatio
  if (mapping.conversionRatio != null && mapping.conversionRatio > 0) {
    return { qty: mapping.conversionRatio, source: 'conversionRatio' }
  }

  // 4. No information available
  return { qty: 1, source: 'default' }
}

// ── Recipe ingredient → stock units ──────────────────────────────────────────

export type IngredientConversionResult = {
  stockQty: number | null
  reason: string | null
}

/**
 * Converts a recipe ingredient's consumption (qtySold × perServeQty) into
 * stock units (whole bottles/packs) for the ingredient's product.
 *
 * @param qtySold       - POS line qty (how many serves were sold)
 * @param itemQty       - ingredient qty per batch (recipe item.qty)
 * @param itemUnit      - ingredient unit ('ml' | 'l' | 'g' | 'kg' | 'each' | custom)
 * @param recipeYield   - serves per batch (recipe.yield, defaults to 1)
 * @param product       - the ingredient's product document (needs .size, .unit)
 */
export function ingredientStockQty(
  qtySold: number,
  itemQty: number | null | undefined,
  itemUnit: string,
  recipeYield: number | null | undefined,
  product: ProductDoc | null,
): IngredientConversionResult {
  // Validate recipe yield — must be a finite number > 0
  if (recipeYield == null || !isFinite(recipeYield) || recipeYield <= 0) {
    return { stockQty: null, reason: 'recipe_yield_invalid' }
  }
  // Validate ingredient qty — must be a finite number > 0
  if (itemQty == null || !isFinite(itemQty) || itemQty <= 0) {
    return { stockQty: null, reason: 'ingredient_qty_missing' }
  }
  const perServeQty = itemQty / recipeYield
  const totalConsumed = qtySold * perServeQty // in item's unit

  const unitLower = (itemUnit ?? '').toLowerCase()

  // Convert to base unit
  let consumedBase: number
  let requiredBase: 'ml' | 'g' | 'each'

  if (unitLower === 'ml') {
    consumedBase = totalConsumed
    requiredBase = 'ml'
  } else if (unitLower === 'l' || unitLower === 'litre' || unitLower === 'liter') {
    consumedBase = totalConsumed * 1000
    requiredBase = 'ml'
  } else if (unitLower === 'cl') {
    consumedBase = totalConsumed * 10
    requiredBase = 'ml'
  } else if (unitLower === 'g') {
    consumedBase = totalConsumed
    requiredBase = 'g'
  } else if (unitLower === 'kg') {
    consumedBase = totalConsumed * 1000
    requiredBase = 'g'
  } else if (unitLower === 'each') {
    consumedBase = totalConsumed
    requiredBase = 'each'
  } else {
    return { stockQty: null, reason: `unrecognised unit: ${itemUnit}` }
  }

  const parsed = parseProductSize(product?.size ?? null, product?.unit ?? null)
  if (!parsed) {
    return { stockQty: null, reason: 'product size unparseable' }
  }
  if (parsed.base !== requiredBase) {
    return { stockQty: null, reason: `base mismatch: item=${requiredBase}, product=${parsed.base}` }
  }

  return { stockQty: consumedBase / parsed.amount, reason: null }
}
