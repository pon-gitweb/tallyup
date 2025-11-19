export type SourceRow = {
  sku: string;
  name?: string;
  unitCost?: number;      // per unit (currently "cost" – may be list or landed depending on data source)
  departmentId?: string;
};

export type CountRow = SourceRow & {
  onHand: number;         // current count (last stock take snapshot)
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

  // Base cost (from products/invoices). For now this is our "list" and "landed"
  // until we wire explicit freight allocation per invoice.
  unitCost?: number;

  onHand: number;
  expected: number;
  variance: number;            // onHand - expected
  value?: number;              // variance * unitCost (signed)

  salesQty: number;            // window sales
  invoiceQty: number;          // window receipts

  // Shrinkage (negative => loss)
  shrinkage: number;

  // NEW: explicit shrinkage metrics + cost tiers
  // shrinkUnits: absolute units lost (0 if none)
  // shrinkValue: value of shrinkage at unitCost
  // listCostPerUnit: current cost from master/last invoice
  // landedCostPerUnit: same as listCostPerUnit for now; future: include freight
  // realCostPerUnit: "burdened" cost per remaining unit after shrinkage
  shrinkUnits?: number;
  shrinkValue?: number;
  listCostPerUnit?: number;
  landedCostPerUnit?: number;
  realCostPerUnit?: number;
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
 * - shrinkage ≈ (expected + invoices - sales) - onHand
 *     Interpretation:
 *       You *should* end with expected; invoices add stock; sales reduce stock.
 *       Compare that theoretical end to actual onHand → negative means loss/shrink.
 *
 * Cost tiers:
 * - listCostPerUnit: unitCost from source (product master / last invoice)
 * - landedCostPerUnit: same as listCostPerUnit for now (freight to be wired later)
 * - realCostPerUnit:
 *      If there is shrinkage, we treat the lost value as burden sharing onto remaining units:
 *         totalValue = unitCost * (onHand + shrinkUnits)
 *         realCostPerUnit = totalValue / onHand
 *      This matches: lose 2 units out of 9, remaining 7 carry the cost of 9.
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

    // Shrinkage formula (see block-level JSDoc):
    const theoretical = expected + r - s; // what we'd expect to have now
    const shrinkage = theoretical - onHand; // negative => loss

    const shrinkUnits = shrinkage < 0 ? Math.abs(shrinkage) : 0;
    const shrinkValue = unitCost != null && shrinkUnits > 0 ? shrinkUnits * unitCost : 0;

    // Cost tiers:
    const listCostPerUnit = unitCost != null ? unitCost : undefined;
    const landedCostPerUnit = listCostPerUnit;

    // Real cost per remaining saleable unit:
    // If there is shrinkage and we still have stock, remaining units carry the loss.
    let realCostPerUnit: number | undefined = undefined;
    if (landedCostPerUnit != null) {
      if (onHand > 0 && shrinkUnits > 0) {
        const totalUnitsValue = landedCostPerUnit * (onHand + shrinkUnits);
        realCostPerUnit = totalUnitsValue / onHand;
      } else {
        realCostPerUnit = landedCostPerUnit;
      }
    }

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
      shrinkUnits,
      shrinkValue,
      listCostPerUnit,
      landedCostPerUnit,
      realCostPerUnit,
    };
  });

  const shortages: UnifiedResultRow[] = [];
  const excesses: UnifiedResultRow[] = [];
  let shortageValue = 0;
  let excessValue = 0;
  let shrinkUnitsTotal = 0;
  let shrinkValueTotal = 0;

  for (const r of rows) {
    if (r.variance < 0) {
      shortages.push(r);
      if (r.value != null) shortageValue += Math.abs(Math.min(r.value, 0));
    } else if (r.variance > 0) {
      excesses.push(r);
      if (r.value != null) excessValue += Math.max(r.value, 0);
    }

    if (r.shrinkage < 0) {
      const su = Math.abs(r.shrinkage);
      shrinkUnitsTotal += su;
      if (r.unitCost != null) shrinkValueTotal += su * r.unitCost;
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
      shrinkageUnits: round2(shrinkUnitsTotal),
      shrinkageValue: round2(shrinkValueTotal),
    },
  };
}
