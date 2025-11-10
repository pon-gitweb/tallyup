/** Shared unit helpers (single source of truth) */

export type BaseUnit = 'ml'|'g'|'each';

export function toBaseUnit(u?: string|null): BaseUnit | null {
  const x = String(u||'').toLowerCase();
  if (x === 'ml' || x === 'l' || x === 'lt' || x === 'liter' || x === 'litre' || x === 'cl' || x === 'dl') return 'ml';
  if (x === 'g' || x === 'kg' || x === 'gram' || x === 'kilogram') return 'g';
  if (x === 'each' || x === 'ea' || x === 'unit' || x === 'count' || x === '') return 'each';
  return null;
}

export function normalizePack(size?: number|null, unit?: string|null): { qty: number, base: BaseUnit } {
  const b = toBaseUnit(unit) || 'each';
  if (!size || size <= 0) return { qty: 1, base: b };
  // scale to base
  if (b === 'ml') {
    const u = String(unit||'').toLowerCase();
    if (u === 'l' || u === 'lt' || u === 'liter' || u === 'litre') return { qty: size * 1000, base: 'ml' };
    if (u === 'cl') return { qty: size * 10, base: 'ml' };
    if (u === 'dl') return { qty: size * 100, base: 'ml' };
    return { qty: size, base: 'ml' };
  }
  if (b === 'g') {
    const u = String(unit||'').toLowerCase();
    if (u === 'kg' || u === 'kilogram') return { qty: size * 1000, base: 'g' };
    return { qty: size, base: 'g' };
  }
  return { qty: size, base: 'each' };
}
