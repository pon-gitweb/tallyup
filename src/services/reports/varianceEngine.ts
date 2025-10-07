export type SourceRow = {
  sku: string;
  name?: string;
  unitCost?: number;      // per unit
  departmentId?: string;
};

export type CountRow = SourceRow & {
  onHand: number;         // current count
  expected?: number;      // par or computed expected
};

export type SalesRow = { sku: string; qty: number };       // qty sold in window (positive)
export type InvoiceRow = { sku: string; qty: number };     // qty received in window (positive)

export type UnifiedOptions = {
  expectedMode?: 'par' | 'movingAvg' | 'salesDriven';
  // window already applied by data adapters
};

export type UnifiedResultRow = {
  sku: string;
  name?: string;
  departmentId?: string;
  unitCost?: number;

  onHand: number;
  expected: number;
  variance: number;            // onHand - expected
  value?: number;              // variance * unitCost (signed)
  salesQty: number;            // window sales
  invoiceQty: number;          // window receipts
  shrinkage: number;           // expected - invoices + ??? vs onHand (see calc below)
};

export type UnifiedResult = {
  rows: UnifiedResultRow[];
  shortages: UnifiedResultRow[];      // variance < 0
  excesses: UnifiedResultRow[];       // variance > 0
  totals: {
    shortageValue: number;            // positive magnitude of negative value
    excessValue: number;              // positive magnitude of positive value
    shrinkageUnits: number;           // sum of shrinkage<0 magnitudes
    shrinkageValue: number;           // |shrinkageUnits| * unitCost
  };
};

/**
 * Core math:
 * - expected is provided by adapters per SKU (par/movingAvg/salesDriven are upstream choices)
 * - variance = onHand - expected
 * - shrinkage ≈ (expected + sales - invoices) - onHand
 *     Interpretation:
 *       You *should* end with expected; then sales reduce stock; invoices add stock.
 *       Compare that theoretical end to actual onHand → negative means loss/shrink.
 */
export function computeUnified(
  counts: CountRow[],
  sales: SalesRow[],
  invoices: InvoiceRow[],
  opts: UnifiedOptions = {}
): UnifiedResult {
  const salesMap = new Map<string, number>();
  for (const s of sales) salesMap.set(s.sku, (salesMap.get(s.sku) || 0) + (s.qty || 0));

  const invMap = new Map<string, number>();
  for (const i of invoices) invMap.set(i.sku, (invMap.get(i.sku) || 0) + (i.qty || 0));

  const rows: UnifiedResultRow[] = counts.map(c => {
    const s = salesMap.get(c.sku) || 0;
    const r = invMap.get(c.sku) || 0;
    const expected = Number.isFinite(c.expected) ? (c.expected as number) : 0;
    const onHand = c.onHand ?? 0;
    const variance = onHand - expected;
    const unitCost = c.unitCost;
    const value = unitCost != null ? variance * unitCost : undefined;

    // shrinkage formula (see block-level JSDoc):
    const theoretical = expected - s + r; // what we'd expect to have now
    const shrinkage = theoretical - onHand; // negative => loss

    return {
      sku: c.sku,
      name: c.name,
      departmentId: c.departmentId,
      unitCost,
      onHand,
      expected,
      variance,
      value,
      salesQty: s,
      invoiceQty: r,
      shrinkage,
    };
  });

  const shortages: UnifiedResultRow[] = [];
  const excesses: UnifiedResultRow[] = [];
  let shortageValue = 0;
  let excessValue = 0;
  let shrinkUnits = 0;
  let shrinkValue = 0;

  for (const r of rows) {
    if (r.variance < 0) {
      shortages.push(r);
      if (r.value != null) shortageValue += Math.abs(Math.min(r.value, 0));
    } else if (r.variance > 0) {
      excesses.push(r);
      if (r.value != null) excessValue += Math.max(r.value, 0);
    }
    if (r.shrinkage < 0) {
      shrinkUnits += Math.abs(r.shrinkage);
      if (r.unitCost != null) shrinkValue += Math.abs(r.shrinkage) * r.unitCost;
    }
  }

  const round2 = (n:number) => Math.round(n * 100) / 100;

  return {
    rows,
    shortages,
    excesses,
    totals: {
      shortageValue: round2(shortageValue),
      excessValue: round2(excessValue),
      shrinkageUnits: round2(shrinkUnits),
      shrinkageValue: round2(shrinkValue),
    },
  };
}
