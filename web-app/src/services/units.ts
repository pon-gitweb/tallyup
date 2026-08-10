/**
 * Shared unit helpers — mirrors src/services/units.ts (mobile).
 * Update both if you change the logic.
 */

export type BaseUnit = 'ml' | 'g' | 'each'

export function toBaseUnit(u?: string | null): BaseUnit | null {
  const x = String(u || '').toLowerCase()
  if (x === 'ml' || x === 'l' || x === 'lt' || x === 'liter' || x === 'litre' || x === 'cl' || x === 'dl') return 'ml'
  if (x === 'g' || x === 'kg' || x === 'gram' || x === 'kilogram') return 'g'
  if (x === 'each' || x === 'ea' || x === 'unit' || x === 'count' || x === '') return 'each'
  return null
}

export function normalizePack(size?: number | null, unit?: string | null): { qty: number; base: BaseUnit } {
  const b = toBaseUnit(unit) || 'each'
  if (!size || size <= 0) return { qty: 1, base: b }
  if (b === 'ml') {
    const u = String(unit || '').toLowerCase()
    if (u === 'l' || u === 'lt' || u === 'liter' || u === 'litre') return { qty: size * 1000, base: 'ml' }
    if (u === 'cl') return { qty: size * 10, base: 'ml' }
    if (u === 'dl') return { qty: size * 100, base: 'ml' }
    return { qty: size, base: 'ml' }
  }
  if (b === 'g') {
    const u = String(unit || '').toLowerCase()
    if (u === 'kg' || u === 'kilogram') return { qty: size * 1000, base: 'g' }
    return { qty: size, base: 'g' }
  }
  return { qty: size, base: 'each' }
}

/**
 * Parse a product's physical-size string (e.g. "700ml", "1.5 L", "375g", "1kg")
 * into a normalised quantity expressed in its base unit (ml, g, or each).
 *
 * Reuses toBaseUnit() for unit recognition — no duplicated unit lists.
 * Returns null — not a guess — for anything that does not cleanly parse,
 * so callers treat unparseable the same as "no size info available".
 *
 * Examples:
 *   "700ml"  → { qty: 700,  base: 'ml' }
 *   "1.5L"   → { qty: 1500, base: 'ml' }
 *   "1.5 l"  → { qty: 1500, base: 'ml' }
 *   "375g"   → { qty: 375,  base: 'g'  }
 *   "1kg"    → { qty: 1000, base: 'g'  }
 *   "20L"    → { qty: 20000, base: 'ml' }
 *   "1each"  → { qty: 1,    base: 'each' }
 *   ""       → null
 *   "keg"    → null  (no numeric prefix)
 */
export function parseProductSize(raw: string | null | undefined): { qty: number; base: BaseUnit } | null {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/)
  if (!m) return null
  const num = parseFloat(m[1])
  if (!Number.isFinite(num) || num <= 0) return null
  const unit = m[2].toLowerCase()
  const base = toBaseUnit(unit)
  if (!base) return null
  if (base === 'ml') {
    if (unit === 'l' || unit === 'lt' || unit === 'liter' || unit === 'litre') return { qty: num * 1000, base: 'ml' }
    if (unit === 'cl') return { qty: num * 10, base: 'ml' }
    if (unit === 'dl') return { qty: num * 100, base: 'ml' }
    return { qty: num, base: 'ml' }
  }
  if (base === 'g') {
    if (unit === 'kg' || unit === 'kilogram') return { qty: num * 1000, base: 'g' }
    return { qty: num, base: 'g' }
  }
  return { qty: num, base: 'each' }
}

/**
 * Compute the proportional cost of using `ingredientQty` of `ingredientUnit`
 * from a product described by `productSize` (e.g. "700ml") at `productCostPrice`
 * (the cost of one whole unit/bottle of that product, per Product.costPrice).
 *
 * Returns null — not 0, not a guess — when the cost cannot be reliably determined:
 *   - productCostPrice is null/undefined/non-finite
 *   - productSize is null or unparseable (except for 'each' — see below)
 *   - ingredient base unit and product size base do not match
 *
 * Special case: when ingredientUnit resolves to 'each', productCostPrice is
 * treated as the cost per single unit and productSize is not consulted —
 * so real "each" products with no meaningful size string are handled correctly.
 *
 * Callers must treat null as "unknown cost", never as zero/free.
 *
 * Example — Jack Daniel's 700ml @ $38.00, using 150ml:
 *   computeIngredientCost(150, 'ml', '700ml', 38.00) → (150/700) × 38.00 ≈ 8.14
 */
export function computeIngredientCost(
  ingredientQty: number,
  ingredientUnit: string,
  productSize: string | null | undefined,
  productCostPrice: number | null | undefined,
): number | null {
  if (productCostPrice == null || !Number.isFinite(Number(productCostPrice))) return null
  const ingBase = toBaseUnit(ingredientUnit)
  if (!ingBase) return null
  // 'each' products: costPrice is already the cost per each — no size division needed
  if (ingBase === 'each') {
    return ingredientQty * Number(productCostPrice)
  }
  const parsed = parseProductSize(productSize)
  if (!parsed || parsed.qty <= 0) return null
  if (ingBase !== parsed.base) return null
  return (ingredientQty / parsed.qty) * Number(productCostPrice)
}
