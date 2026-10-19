/**
 * Pure product-size parser.
 *
 * Converts free-text size/unit fields from product docs into a normalised
 * { amount, base } triple so conversion logic can work in consistent units.
 *
 * Returns null rather than guess when the input is absent or unrecognised.
 */

export type ParsedSize = { amount: number; base: 'ml' | 'g' | 'each' }

/**
 * Parse a product size string (and optional separate unit field) into a
 * normalised { amount, base } triple.
 *
 * Handles:
 *   Liquids  : ml, ML, cl, l/L/litre/liter/litres/liters, with optional suffix
 *   Weights  : g, G, kg, KG, with optional suffix
 *   Each     : "- Each", "each", "1 each", etc.
 *   Combos   : "2L Bottle", "1kg Dry/Bag", "200g Sachet"
 *
 * Returns null for blank / null / unrecognised inputs.
 */
export function parseProductSize(
  size: string | null | undefined,
  unit?: string | null,
): ParsedSize | null {
  const raw = (size ?? '').trim()
  if (!raw) {
    // Fallback: check unit field alone
    return parseUnitField(unit)
  }

  const lower = raw.toLowerCase()

  // "- Each" / "each" / "1 each" etc.
  if (/^-?\s*each$/i.test(lower) || /^\d+\s*each$/i.test(lower)) {
    return { amount: 1, base: 'each' }
  }

  // Try to extract a leading number (int or decimal) followed by a unit token
  const m = raw.match(/^([\d.]+)\s*([a-zA-Z]+)/)
  if (m) {
    const num = parseFloat(m[1])
    const u   = m[2].toLowerCase()
    if (!isFinite(num) || num <= 0) return null

    if (u === 'ml') return { amount: num, base: 'ml' }
    if (u === 'cl') return { amount: num * 10, base: 'ml' }
    if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') {
      return { amount: num * 1000, base: 'ml' }
    }
    if (u === 'g') return { amount: num, base: 'g' }
    if (u === 'kg') return { amount: num * 1000, base: 'g' }
    return null
  }

  // No numeric prefix found — check unit field as fallback
  return parseUnitField(unit)
}

function parseUnitField(unit: string | null | undefined): ParsedSize | null {
  if (!unit) return null
  const u = unit.trim().toLowerCase()
  if (u === 'each') return { amount: 1, base: 'each' }
  return null
}
