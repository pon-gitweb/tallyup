// @ts-nocheck
/**
 * Department-aware suggestion engine.
 * - Reads optional product.parByDept[deptKey]
 * - Falls back to product.par, then opts.defaultParIfMissing
 * - Computes suggestions per-dept, then produces an "ALL" aggregate by supplier
 * - Preserves legacy type names to avoid breaking older imports
 */

import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, doc, getDoc, query, where
} from 'firebase/firestore';

export type SuggestedLine = {
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string | null;
  deptKey?: string | null;         // 'bar' | 'kitchen' | 'office' etc.
  qty: number;                     // suggested order qty
  unitCost?: number | null;
  packSize?: number | null;
};

export type SupplierBucket = {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestedLine[];
};

export type SuggestedMap = Record<string /*supplierId|null:'unassigned'*/, SupplierBucket>;

export type SuggestedByDept = Record<string /* deptKey | 'ALL' */, SuggestedMap>;

/** Back-compat alias to avoid breaking old imports */
export type SuggestedLegacyMap = SuggestedByDept;

type BuildOpts = {
  defaultParIfMissing?: number;  // e.g. 6
  roundToPack?: boolean;         // round result up to nearest packSize
};

/** Util: pick a PAR for a given department with safe fallbacks */
function parForDept(prod: any, deptKey: string | null | undefined, fallback: number): number {
  const byDept = (prod?.parByDept && typeof prod.parByDept === 'object') ? prod.parByDept : null;
  const fromDept = (deptKey && byDept && Number.isFinite(byDept[deptKey])) ? Number(byDept[deptKey]) : null;
  const globalPar = Number.isFinite(prod?.par) ? Number(prod.par) : null;

  if (Number.isFinite(fromDept) && (fromDept as number) >= 0) return fromDept!;
  if (Number.isFinite(globalPar) && (globalPar as number) >= 0) return globalPar!;
  return Number.isFinite(fallback) ? (fallback as number) : 0;
}

/** Util: round up to nearest pack size if set and > 1 */
function maybeRoundToPack(qty: number, packSize?: number | null, on: boolean = false): number {
  const ps = Number.isFinite(packSize) ? Number(packSize) : null;
  if (!on || !ps || ps <= 1) return Math.max(0, Math.round(qty));
  const n = Math.max(0, Math.ceil(qty / ps) * ps);
  return n;
}

/**
 * Firestore shape expectations (venue-scoped):
 * - suppliers: id, { name, orderCutoffLocalTime?, mergeWindowHours? }
 * - products:  id, { name, supplierId?, supplierName?, unitCost?, packSize?, par?, parByDept? }
 * - stock, per department, is inferred from latest area item counts the app already writes.
 *   We read department → areas → items: each item has productId and countedQty (or total) per last submission.
 *
 * NOTE: We lean on what's already being written by your live app. If a product has no recent count for a dept,
 * we treat current=0, which encourages a top-up to the dept's PAR.
 */
export async function buildSuggestedOrdersInMemory(
  opts: BuildOpts,
  venueId: string
): Promise<{ byDept: SuggestedByDept }> {
  const db = getFirestore(getApp());
  const defaultPar = Number.isFinite(opts?.defaultParIfMissing) ? Number(opts?.defaultParIfMissing) : 6;
  const roundPacks = !!opts?.roundToPack;

  // 1) Suppliers
  const supSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const suppliers: Record<string, any> = {};
  supSnap.forEach(d => suppliers[d.id] = { id: d.id, ...(d.data() || {}) });

  // 2) Products
  const proSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const products: Record<string, any> = {};
  proSnap.forEach(d => products[d.id] = { id: d.id, ...(d.data() || {}) });

  // 3) Department current counts
  //    We read departments and their area items. Your app already writes these; we only aggregate.
  //    Expected shapes:
  //      venues/{venue}/departments/{deptId}
  //      venues/{venue}/departments/{deptId}/areas/{areaId}/items/{itemId} -> { productId, qty?:number, countedQty?:number, lastCount?:number }
  const deptSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const deptKeys: string[] = [];
  deptSnap.forEach(d => {
    const dk = (d.id || '').trim();
    if (dk) deptKeys.push(dk);
  });

  // Aggregate product current qty per dept
  const currentByDept: Record<string, Record<string /*productId*/, number>> = {};
  for (const dk of deptKeys) {
    currentByDept[dk] = {};
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dk, 'areas'));
    const areaIds: string[] = [];
    areasSnap.forEach(a => areaIds.push(a.id));

    for (const areaId of areaIds) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dk, 'areas', areaId, 'items'));
      itemsSnap.forEach(it => {
        const iv = (it.data() || {});
        const pid = String(iv?.productId || '').trim();
        if (!pid) return;
        const count = Number.isFinite(iv?.qty) ? Number(iv.qty)
                    : Number.isFinite(iv?.countedQty) ? Number(iv.countedQty)
                    : Number.isFinite(iv?.lastCount) ? Number(iv.lastCount)
                    : 0;
        currentByDept[dk][pid] = (currentByDept[dk][pid] || 0) + count;
      });
    }
  }

  // Helper to add a line to a supplier bucket in a given dept map
  function pushDeptLine(map: SuggestedMap, supId: string | null, supName: string | null, line: SuggestedLine) {
    const key = supId || 'unassigned';
    if (!map[key]) {
      map[key] = { supplierId: supId, supplierName: supName, lines: [] };
    }
    map[key].lines.push(line);
  }

  // 4) Build per-dept suggestions
  const byDept: SuggestedByDept = {};

  for (const dk of deptKeys) {
    const deptMap: SuggestedMap = {};
    const cur = currentByDept[dk] || {};

    // For products that exist OR have non-zero current, compute target
    const productIds = new Set<string>([...Object.keys(products), ...Object.keys(cur)]);
    for (const pid of productIds) {
      const p = products[pid] || { id: pid, name: pid };
      const name = p?.name || pid;
      const supplierId: string | null = p?.supplierId || null;
      const supplierName: string | null = p?.supplierName || (supplierId ? (suppliers[supplierId]?.name || null) : null);

      const unitCost = Number.isFinite(p?.unitCost) ? Number(p.unitCost) : null;
      const packSize = Number.isFinite(p?.packSize) ? Number(p.packSize) : null;

      const current = Number(cur[pid] || 0);
      const targetPar = parForDept(p, dk, defaultPar);
      let needed = Math.max(0, targetPar - current);
      needed = maybeRoundToPack(needed, packSize, roundPacks);

      if (needed > 0) {
        pushDeptLine(deptMap, supplierId, supplierName, {
          productId: pid,
          productName: name,
          supplierId,
          supplierName,
          deptKey: dk,
          qty: needed,
          unitCost,
          packSize
        });
      }
    }

    byDept[dk] = deptMap;
  }

  // 5) Build ALL = sum of dept lines by supplier/product
  const allMap: SuggestedMap = {};
  for (const dk of Object.keys(byDept)) {
    const m = byDept[dk];
    Object.keys(m).forEach(supKey => {
      const bucket = m[supKey];
      const supId = bucket.supplierId || null;
      const supName = bucket.supplierName || null;

      if (!allMap[supKey]) {
        allMap[supKey] = { supplierId: supId, supplierName: supName, lines: [] };
      }
      // Merge by productId
      for (const line of bucket.lines) {
        const existingIdx = allMap[supKey].lines.findIndex(L => L.productId === line.productId);
        if (existingIdx >= 0) {
          allMap[supKey].lines[existingIdx].qty += line.qty;
        } else {
          allMap[supKey].lines.push({ ...line, deptKey: undefined }); // drop deptKey in ALL
        }
      }
    });
  }

  byDept['ALL'] = allMap;

  return { byDept };
}
