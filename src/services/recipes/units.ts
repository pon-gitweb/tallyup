export type Base = 'ml' | 'g' | 'each';

export const UNIT_PRESETS: string[] = [
  'ml','l','g','kg','each','serve'
];

// Aliases used in bars (values in ml)
export const SHOT_ALIASES: Record<string, number> = {
  // NZ common
  single: 15,
  double: 30,
  'single-nz': 15,
  'double-nz': 30,
  // extras
  shot: 30,
  dash: 1,
  splash: 5,
};

export function normalizePortion(value: string, unit: string): { qtyBase: number, base: Base } {
  const u = (unit || '').toLowerCase().trim();

  // handle textual aliases (single, double, dash, splash)
  const alias = SHOT_ALIASES[(value || '').toLowerCase().trim()];
  if (alias != null) {
    return { qtyBase: alias, base: 'ml' };
  }

  // numeric value
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { qtyBase: 0, base: 'ml' };

  // to base units
  if (u === 'ml') return { qtyBase: n, base: 'ml' };
  if (u === 'l' || u === 'litre' || u === 'liter') return { qtyBase: n * 1000, base: 'ml' };
  if (u === 'g' || u === 'gram') return { qtyBase: n, base: 'g' };
  if (u === 'kg') return { qtyBase: n * 1000, base: 'g' };
  if (u === 'each' || u === 'serve') return { qtyBase: n, base: 'each' };

  // default: treat unknown as ml
  return { qtyBase: n, base: 'ml' };
}

export function toBaseFromContainer(size: number, unit: string): { sizeBase: number, base: Base } {
  const u = (unit || '').toLowerCase().trim();
  const n = Number(String(size).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return { sizeBase: 0, base: 'ml' };

  if (u === 'ml') return { sizeBase: n, base: 'ml' };
  if (u === 'l' || u === 'litre' || u === 'liter') return { sizeBase: n * 1000, base: 'ml' };
  if (u === 'g' || u === 'gram') return { sizeBase: n, base: 'g' };
  if (u === 'kg') return { sizeBase: n * 1000, base: 'g' };
  if (u === 'each') return { sizeBase: n, base: 'each' };

  return { sizeBase: n, base: 'ml' };
}
