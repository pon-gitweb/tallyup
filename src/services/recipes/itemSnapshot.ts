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
  // Recipe pricing-integrity fields (optional — pass through only when present)
  costPerServe?: number | null;
  manualCost?: boolean;
  isInHouse?: boolean;
  matchedProductName?: string | null;
  needsRepricing?: boolean;
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
    // Additive pricing-integrity fields — only written when explicitly present on the row,
    // so existing rows/readers that never set them are completely unaffected.
    if (r?.costPerServe !== undefined) out.costPerServe = n(r.costPerServe);
    if (r?.manualCost !== undefined) out.manualCost = !!r.manualCost;
    if (r?.isInHouse !== undefined) out.isInHouse = !!r.isInHouse;
    if (r?.matchedProductName !== undefined) out.matchedProductName = s(r.matchedProductName);
    if (r?.needsRepricing !== undefined) out.needsRepricing = !!r.needsRepricing;
    Object.keys(out).forEach(k => { if (out[k] === undefined) out[k] = null; });
    return out;
  });
}
