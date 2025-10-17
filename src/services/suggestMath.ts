// @ts-nocheck
/**
 * Lightweight in-memory "suggested orders" builder.
 * - Buckets products by supplier when BOTH supplierId and par are present.
 * - Anything missing either supplierId or par goes to the `unassigned` bucket with reasons.
 * - Quantity heuristic: if we don't have on-hand counts here, default to 1 (can be edited later).
 * You can swap in your richer stock/area math later without changing the caller.
 */

import {
  getFirestore,
  collection,
  query,
  orderBy,
  getDocs,
} from 'firebase/firestore';

/** Options accepted by the builder */
export type BuildSuggestedOpts = {
  defaultParIfMissing?: number; // used only for UI messaging; we don't persist par here
  roundToPack?: boolean;        // left for compatibility with callers
};

/** One suggested line in a bucket */
export type SuggestedLine = {
  productId: string;
  productName: string;
  qty: number;
  cost: number;
  /** Flags for "unassigned" remediation UI */
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: 'no_par' | 'no_supplier' | 'both';
};

/** A supplier/unassigned bucket */
export type SuggestedBucket = {
  id: string;            // 'unassigned' or supplierId
  name: string;          // 'Unassigned' or supplier name
  lines: SuggestedLine[];
};

/** Final return shape: one "unassigned" bucket plus supplier buckets by id */
export type SuggestedResult = {
  unassigned: SuggestedBucket;
  [supplierId: string]: any; // SuggestedBucket entries keyed by supplier id
};

/** Internal helpers */
async function listSuppliers(venueId: string) {
  const db = getFirestore();
  const col = collection(db, `venues/\${venueId}/suppliers`);
  // orderBy('name') if the field exists; if not, fall back to un-ordered
  try {
    const snap = await getDocs(query(col, orderBy('name')));
    const rows: any[] = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    return rows;
  } catch {
    const snap = await getDocs(col);
    const rows: any[] = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    return rows;
  }
}

async function listProducts(venueId: string) {
  const db = getFirestore();
  const col = collection(db, `venues/\${venueId}/products`);
  const snap = await getDocs(col);
  const rows: any[] = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  return rows;
}

/**
 * Build in-memory suggested orders.
 * This function is intentionally tolerant and logs useful counts so your
 * screen can display what you’re seeing in the console logs.
 */
export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: BuildSuggestedOpts = { defaultParIfMissing: 6, roundToPack: true }
): Promise<SuggestedResult> {
  console.log('[SuggestedOrders] ENTER buildSuggestedOrdersInMemory', { venueId, opts });

  // Load data
  console.log('[SuggestedOrders] reading query suppliers.list');
  const suppliers = await listSuppliers(venueId);

  console.log('[SuggestedOrders] reading query products.list');
  const products = await listProducts(venueId);

  // Index suppliers by id -> { id, name }
  const supplierIndex: Record<string, { id: string; name: string }> = {};
  suppliers.forEach(s => {
    const name = s?.name || s?.supplierName || s?.displayName || 'Supplier';
    if (s?.id) supplierIndex[s.id] = { id: s.id, name };
  });

  // Seed result object with unassigned bucket
  const result: SuggestedResult = {
    unassigned: {
      id: 'unassigned',
      name: 'Unassigned',
      lines: [],
    },
  };

  // Create buckets for known suppliers up-front (nice for counts on the landing screen)
  suppliers.forEach(s => {
    const id = s?.id;
    if (!id) return;
    if (!result[id]) {
      result[id] = {
        id,
        name: supplierIndex[id]?.name ?? (s?.name || 'Supplier'),
        lines: [],
      };
    }
  });

  // Walk products and place into buckets
  const productIds = new Set<string>();
  products.forEach(p => {
    const productId = p?.id;
    if (!productId) return;
    productIds.add(productId);

    const productName = p?.name || p?.productName || 'Product';
    const supplierId = p?.supplierId || p?.supplier?.id || null;
    const supplierName =
      p?.supplierName || p?.supplier?.name || (supplierId ? supplierIndex[supplierId]?.name : null);

    // Par logic: treat "missing or non-positive" as missing
    const parRaw = p?.par;
    const hasPar = Number.isFinite(parRaw) && parRaw > 0;

    // If missing either par or supplier, it belongs in 'unassigned'
    if (!hasPar || !supplierId) {
      const reason: SuggestedLine['reason'] =
        !hasPar && !supplierId ? 'both' : !hasPar ? 'no_par' : 'no_supplier';

      result.unassigned.lines.push({
        productId,
        productName,
        qty: 1,
        cost: Number(p?.cost) || 0,
        needsPar: !hasPar,
        needsSupplier: !supplierId,
        reason,
      });
      return;
    }

    // Otherwise, add to supplier bucket as a suggested line.
    // We don't have live stock-on-hand here; pick a conservative default of 1.
    // Your OrderEditor lets users adjust before submit.
    const qty = 1;
    const cost = Number(p?.cost) || 0;

    if (!result[supplierId]) {
      result[supplierId] = {
        id: supplierId,
        name: supplierName || supplierId,
        lines: [],
      };
    }

    result[supplierId].lines.push({
      productId,
      productName,
      qty,
      cost,
    });
  });

  // Tally log (handy for parity with your existing logs)
  const perSupplierCounts: Record<string, number> = {};
  Object.keys(result).forEach(k => {
    if (k === 'unassigned') {
      perSupplierCounts['unassigned'] = result.unassigned.lines.length;
    } else {
      perSupplierCounts[k] = result[k]?.lines?.length || 0;
    }
  });

  const suppliersWithLines = Object.keys(result).filter(
    k => k !== 'unassigned' && (result[k]?.lines?.length || 0) > 0
  ).length;

  const totalLines =
    Object.keys(result).reduce((sum, k) => sum + ((result[k]?.lines?.length) || 0), 0);

  console.log('[SuggestedOrders] countedProductIds', { count: productIds.size });
  console.log('[SuggestedOrders] summary', { suppliersWithLines, totalLines });
  console.log('[SuggestedOrders] perSupplierCounts', perSupplierCounts);

  // Compatibility diagnostics you were logging
  const compatKeys = [
    'unassigned',
    '__no_supplier__',
    'no_supplier',
    'none',
    'null',
    'undefined',
    '',
    ...Object.keys(supplierIndex),
  ];
  console.log('[SO DEBUG] compat keys=', compatKeys);
  console.log('[SO DEBUG] compat unassigned.len=', result.unassigned.lines.length);

  if (result.unassigned.lines.length > 0) {
    console.log('[SO DEBUG] compat sampleBucket.id=', '__no_supplier__');
    console.log('[SO DEBUG] compat sampleBucket.lines[0]=', result.unassigned.lines[0]);
  }

  return result;
}
