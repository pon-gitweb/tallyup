/**
 * Firestore-safe snapshot of UI ingredient rows.
 * - Removes UI-only keys
 * - Flattens link
 * - Replaces undefined/NaN with null
 * - Writes BOTH `name` and `productName` for maximum compatibility
 */
export type UiRow = {
  key?: string;
  name: string;
  qty: number;
  unit: 'ml'|'g'|'each'|string;
  link?: { productId?: string; packSize?: number|null; packUnit?: string|null; packPrice?: number|null };
};

function n(x: any): number|null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function s(x: any): string|null {
  if (x === undefined || x === null) return null;
  const t = String(x).trim();
  return t.length ? t : null;
}

export function makeFirestoreItemSnapshot(rows: UiRow[]|null|undefined) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const productId = s(r?.link?.productId);
    const label = s(r?.name);
    const out: any = {
      productId: productId || null,
      // write BOTH fields so legacy readers (expecting `name`) and newer ones (using `productName`) work
      name: label || null,
      productName: label || null,
      qty: n(r?.qty) ?? 0,
      unit: s(r?.unit) || 'each',
      packSize: n(r?.link?.packSize),
      packUnit: s(r?.link?.packUnit),
      packPrice: n(r?.link?.packPrice),
    };
    Object.keys(out).forEach(k => { if (out[k] === undefined) out[k] = null; });
    return out;
  });
}
