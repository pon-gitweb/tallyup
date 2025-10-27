// @ts-nocheck
/**
 * catalogSafe.ts
 * A crash-proof facade: tries real catalog service first, then Firestore, else returns [].
 * Returns: Array<{ id, name, sku?, unit?, size?, packSize?, costPrice?, gstPercent?, supplierName? }>
 */
let triedReal = false;
let real:any = null;
try {
  real = require('./catalog'); // if your real service exists, great
  triedReal = true;
} catch {}

import { getFirestore, collection, getDocs, query, limit, where, orderBy } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type Row = {
  id: string;
  name?: string|null;
  sku?: string|null;
  unit?: string|null;
  size?: string|null;
  packSize?: number|null;
  costPrice?: number|null;
  gstPercent?: number|null;
  supplierName?: string|null;
};

export async function searchProducts(term: string, max: number = 10): Promise<Row[]> {
  const t = String(term || '').trim();
  // 1) Real service (if present)
  if (triedReal && real && typeof real.searchProducts === 'function') {
    try {
      const rows = await real.searchProducts(t, max);
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      // swallow; fall through to fallback
    }
  }

  // 2) Firestore fallback (optional): venues-agnostic "catalog/products"
  try {
    if (!t) return [];
    const db = getFirestore(getApp());
    // This is intentionally simple. If you have a better indexed collection, wire it here.
    // We "OR"-simulate by running two small queries and merging.
    const col = collection(db, 'catalog', 'global', 'products');

    const tryByName = async () => {
      try {
        // naive starts-with search using orderBy('name') where name >= t
        const q = query(col, orderBy('name'), limit(max));
        const snap = await getDocs(q);
        return snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(r => (r?.name || '').toLowerCase().includes(t.toLowerCase()));
      } catch { return []; }
    };

    const tryBySku = async () => {
      try {
        const q = query(col, where('sku', '==', t), limit(max));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      } catch { return []; }
    };

    const [a, b] = await Promise.all([tryByName(), tryBySku()]);
    const seen = new Set<string>();
    const merged: Row[] = [];
    for (const r of [...a, ...b]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push({
        id: r.id,
        name: r.name ?? null,
        sku: r.sku ?? null,
        unit: r.unit ?? null,
        size: r.size ?? null,
        packSize: Number.isFinite(r?.packSize) ? Number(r.packSize) : null,
        costPrice: Number.isFinite(r?.costPrice) ? Number(r.costPrice) : (Number.isFinite(r?.price) ? Number(r.price) : null),
        gstPercent: Number.isFinite(r?.gstPercent) ? Number(r.gstPercent) : 15,
        supplierName: r.supplierName ?? null,
      });
      if (merged.length >= max) break;
    }
    return merged;
  } catch {
    // 3) Nothing available: return empty, never throw
    return [];
  }
}
