// @ts-nocheck
/**
 * Reconciliation engine: parsed invoice lines (CSV/PDF) vs submitted order lines.
 * - Conservative matching: productId -> code -> normalized name
 * - Computes qty/price deltas, totals, and anomalies
 * - Does NOT mutate Firestore; just returns a bundle for storage/reporting
 */

export type ParsedInvoiceLine = {
  productId?: string;
  code?: string;
  name: string;
  qty: number;           // invoice quantity
  unitPrice?: number;    // invoice unit price (ex GST), may be undefined
};

export type OrderLine = {
  id: string;            // line doc id
  productId?: string;
  name?: string;
  qty?: number;          // ordered quantity
  unitCost?: number;     // ordered unit cost
};

export type ReconciliationMatch = {
  key: string; // productId|code|name-based key used
  via: 'productId'|'code'|'name';
  order?: {
    id: string;
    productId?: string;
    name?: string;
    qty: number;
    unitCost: number;
    ext: number; // qty * unitCost
  } | null;
  invoice?: {
    productId?: string;
    code?: string;
    name: string;
    qty: number;
    unitPrice: number;
    ext: number; // qty * unitPrice
  } | null;
  deltas: {
    qtyDelta: number;    // invoice.qty - order.qty
    priceDelta: number;  // invoice.unitPrice - order.unitCost
    valueDelta: number;  // invoice.ext - order.ext
  };
  flags: {
    newItem?: boolean;       // invoice-only
    missingItem?: boolean;   // order-only
    qtyChanged?: boolean;
    priceChanged?: boolean;
    zeroPrice?: boolean;
    zeroQty?: boolean;
  };
};

export type ReconciliationTotals = {
  orderValue: number;    // sum(order.qty*unitCost)
  invoiceValue: number;  // sum(invoice.qty*unitPrice) (+ landedAdj if applied)
  valueDelta: number;    // invoiceValue - orderValue
  linesMatched: number;
  linesInvoiceOnly: number;
  linesOrderOnly: number;
};

export type ReconciliationAnomaly =
  | { kind: 'NEGATIVE_QTY'; where: 'invoice'|'order'; key: string; qty: number }
  | { kind: 'NEGATIVE_PRICE'; key: string; unit: number }
  | { kind: 'ZERO_PRICE'; key: string }
  | { kind: 'DUPLICATE_INVOICE_KEY'; key: string }
  | { kind: 'DUPLICATE_ORDER_KEY'; key: string };

export type ReconciliationMeta = {
  source: 'csv'|'pdf';
  storagePath: string;
  poNumber: string|null;
  confidence: number|null;
  warnings: string[];
  landed?: {
    freight?: number;        // as provided/derived externally (future)
    surcharges?: number;
    credits?: number;
    allocation?: 'none'|'prorata_ext'; // default none
  };
};

export type ReconciliationResult = {
  meta: ReconciliationMeta;
  matches: ReconciliationMatch[];  // aligned rows (including new/missing)
  totals: ReconciliationTotals;
  anomalies: ReconciliationAnomaly[];
  summary: {
    qtyChanged: number;
    priceChanged: number;
    newItems: number;
    missingItems: number;
  };
};

function normName(s?: string) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-./]/g, '')
    .trim();
}

function pickKey(
  inv: ParsedInvoiceLine | null,
  ord: OrderLine | null
): { key: string, via: 'productId'|'code'|'name' } {
  if (inv?.productId || ord?.productId) {
    const k = (inv?.productId || ord?.productId || '').trim();
    if (k) return { key: `pid:${k}`, via: 'productId' };
  }
  if (inv?.code) {
    const k = String(inv.code).trim().toLowerCase();
    if (k) return { key: `code:${k}`, via: 'code' };
  }
  if (ord?.name || inv?.name) {
    const k = normName(inv?.name || ord?.name || '');
    if (k) return { key: `name:${k}`, via: 'name' };
  }
  // Fallback (should be rare)
  const r = inv ? (inv.code || inv.name || '') : (ord?.name || ord?.id || '');
  return { key: `name:${normName(r)}`, via: 'name' };
}

function buildIndex<T>(
  arr: T[],
  getKey: (x: T) => string
): { map: Record<string, T>, dups: string[] } {
  const map: Record<string, T> = {};
  const dups: string[] = [];
  for (const x of arr) {
    const k = getKey(x);
    if (!k) continue;
    if (map[k]) {
      dups.push(k);
      continue; // keep first
    }
    map[k] = x;
  }
  return { map, dups };
}

function toOrderKey(o: OrderLine) {
  const viaPid = o.productId ? `pid:${o.productId}` : '';
  if (viaPid) return viaPid;
  const viaName = normName(o.name || '');
  return viaName ? `name:${viaName}` : `name:${normName(o.id)}`;
}

function toInvoiceKey(i: ParsedInvoiceLine) {
  if (i.productId) return `pid:${i.productId}`;
  if (i.code) return `code:${String(i.code).trim().toLowerCase()}`;
  return `name:${normName(i.name)}`;
}

function safeNum(n: any, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Optional landed-cost allocation (future-proof).
 * Currently supports: 'none' or 'prorata_ext' (by invoice extended value).
 */
function allocateLanded(meta: ReconciliationMeta, invExtTotalsByKey: Record<string, number>) {
  const landedTotal =
    safeNum(meta?.landed?.freight, 0) +
    safeNum(meta?.landed?.surcharges, 0) -
    safeNum(meta?.landed?.credits, 0);

  if (!landedTotal || meta?.landed?.allocation !== 'prorata_ext') {
    return { perKeyAdj: {} as Record<string, number>, totalAdj: 0 };
  }

  const totalExt = sum(Object.values(invExtTotalsByKey));
  if (totalExt <= 0) return { perKeyAdj: {}, totalAdj: 0 };

  const perKeyAdj: Record<string, number> = {};
  for (const [k, ext] of Object.entries(invExtTotalsByKey)) {
    perKeyAdj[k] = (ext / totalExt) * landedTotal;
  }
  return { perKeyAdj, totalAdj: landedTotal };
}

export function reconcileInvoiceWithOrder(
  invoiceLines: ParsedInvoiceLine[],
  orderLines: OrderLine[],
  meta: ReconciliationMeta,
  opts?: { qtyTolerance?: number; priceTolerance?: number }
): ReconciliationResult {
  const qtyTol = Math.max(0, safeNum(opts?.qtyTolerance, 0));
  const priceTol = Math.max(0, safeNum(opts?.priceTolerance, 0));

  // Build indices
  const ordIndex = buildIndex(orderLines, toOrderKey);
  const invIndex = buildIndex(invoiceLines, toInvoiceKey);

  const anomalies: ReconciliationAnomaly[] = [];
  ordIndex.dups.forEach(k => anomalies.push({ kind: 'DUPLICATE_ORDER_KEY', key: k }));
  invIndex.dups.forEach(k => anomalies.push({ kind: 'DUPLICATE_INVOICE_KEY', key: k }));

  // Pre-collect invoice ext totals for potential landed allocation
  const invExtByKey: Record<string, number> = {};
  for (const [key, i] of Object.entries(invIndex.map)) {
    const qty = safeNum(i.qty, 0);
    const price = safeNum(i.unitPrice, 0);
    const ext = Math.max(0, qty) * Math.max(0, price);
    invExtByKey[key] = ext;

    if (qty < 0) anomalies.push({ kind: 'NEGATIVE_QTY', where: 'invoice', key, qty });
    if (price < 0) anomalies.push({ kind: 'NEGATIVE_PRICE', key, unit: price });
    if (price === 0) anomalies.push({ kind: 'ZERO_PRICE', key });
  }
  for (const [key, o] of Object.entries(ordIndex.map)) {
    const qty = safeNum(o.qty, 0);
    if (qty < 0) anomalies.push({ kind: 'NEGATIVE_QTY', where: 'order', key, qty });
  }

  const landed = allocateLanded(meta, invExtByKey);

  const visited = new Set<string>();
  const matches: ReconciliationMatch[] = [];

  // 1) Stitch by keys present in either side
  const keys = new Set<string>([
    ...Object.keys(ordIndex.map),
    ...Object.keys(invIndex.map),
  ]);

  for (const key of keys) {
    const o = ordIndex.map[key] || null;
    const i = invIndex.map[key] || null;

    // Determine "via"
    const via = ((): 'productId'|'code'|'name' => {
      if (key.startsWith('pid:')) return 'productId';
      if (key.startsWith('code:')) return 'code';
      return 'name';
    })();

    const ordQty = safeNum(o?.qty, 0);
    const ordPrice = safeNum(o?.unitCost, 0);
    const invQty = safeNum(i?.qty, 0);
    const invPrice = safeNum(i?.unitPrice, 0);

    const orderExt = ordQty * ordPrice;
    const invoiceExtBase = invQty * invPrice;
    const landedAdj = landed.perKeyAdj[key] || 0;
    const invoiceExt = invoiceExtBase + landedAdj;

    const qtyDelta = invQty - ordQty;
    const priceDelta = invPrice - ordPrice;
    const valueDelta = invoiceExt - orderExt;

    const rec: ReconciliationMatch = {
      key,
      via,
      order: o
        ? {
            id: o.id,
            productId: o.productId,
            name: o.name || '',
            qty: ordQty,
            unitCost: ordPrice,
            ext: orderExt,
          }
        : null,
      invoice: i
        ? {
            productId: i.productId,
            code: i.code,
            name: i.name,
            qty: invQty,
            unitPrice: invPrice,
            ext: invoiceExt,
          }
        : null,
      deltas: { qtyDelta, priceDelta, valueDelta },
      flags: {
        newItem: !!i && !o,
        missingItem: !!o && !i,
        qtyChanged: Math.abs(qtyDelta) > qtyTol,
        priceChanged: Math.abs(priceDelta) > priceTol,
        zeroPrice: !!i && invPrice === 0,
        zeroQty: !!i && invQty === 0,
      },
    };

    matches.push(rec);
    visited.add(key);
  }

  // 2) Totals & summary
  const orderValue = sum(matches.map(m => m.order?.ext || 0));
  const invoiceValue = sum(matches.map(m => m.invoice?.ext || 0));
  const totals: ReconciliationTotals = {
    orderValue,
    invoiceValue,
    valueDelta: invoiceValue - orderValue,
    linesMatched: matches.filter(m => m.order && m.invoice).length,
    linesInvoiceOnly: matches.filter(m => m.flags.newItem).length,
    linesOrderOnly: matches.filter(m => m.flags.missingItem).length,
  };

  const summary = {
    qtyChanged: matches.filter(m => m.flags.qtyChanged && m.order && m.invoice).length,
    priceChanged: matches.filter(m => m.flags.priceChanged && m.order && m.invoice).length,
    newItems: matches.filter(m => m.flags.newItem).length,
    missingItems: matches.filter(m => m.flags.missingItem).length,
  };

  return {
    meta: {
      source: meta.source,
      storagePath: meta.storagePath,
      poNumber: meta.poNumber ?? null,
      confidence: meta.confidence ?? null,
      warnings: meta.warnings || [],
      landed: meta.landed, // passthrough
    },
    matches,
    totals,
    anomalies,
    summary,
  };
}
