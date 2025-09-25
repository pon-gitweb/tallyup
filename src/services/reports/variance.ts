import { listProducts } from '../../services/products';
import { getOnHandByProduct } from '../../services/inventory';

export type VarianceRow = {
  productId: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  par: number;
  onHand: number;
  variance: number;          // onHand - par (negative = shortage)
  unitCost: number | null;   // uses product.cost if present
  valueImpact: number;       // variance * unitCost (0 if cost missing)
};

export type VarianceResult = {
  rows: VarianceRow[];
  shortages: VarianceRow[];  // variance < 0
  excess: VarianceRow[];     // variance > 0
  totals: {
    shortageValue: number;   // negative number (total missing $)
    excessValue: number;     // positive number (overstock $)
  };
};

/**
 * Computes variance vs par (per product) using real on‑hand from inventory.
 * - onHand comes from lastCount aggregation across all areas (see services/inventory.ts)
 * - par/packSize/cost pulled from products
 */
export async function computeVarianceSnapshot(venueId: string): Promise<VarianceResult> {
  const [products, onHandMap] = await Promise.all([
    listProducts(venueId),
    getOnHandByProduct(venueId),
  ]);

  const rows: VarianceRow[] = [];

  for (const p of products) {
    const pid = (p as any).id as string | undefined;
    if (!pid) continue;

    const name = (p as any).name as string;
    const sku = (p as any).sku ?? null;
    const unit = (p as any).unit ?? null;

    const parRaw = (p as any).parLevel;
    const par = typeof parRaw === 'number' ? parRaw : Number(parRaw);
    if (!isFinite(par)) continue; // skip products with no par

    const onHand = onHandMap[pid] || 0;

    const unitCostRaw = (p as any).cost;
    const unitCost = unitCostRaw != null && isFinite(Number(unitCostRaw)) ? Number(unitCostRaw) : null;

    const variance = onHand - par;
    const valueImpact = unitCost != null ? variance * unitCost : 0;

    rows.push({
      productId: pid,
      name,
      sku,
      unit,
      par,
      onHand,
      variance,
      unitCost,
      valueImpact,
    });
  }

  const shortages = rows.filter(r => r.variance < 0)
    .sort((a, b) => Math.abs(b.valueImpact) - Math.abs(a.valueImpact) || a.name.localeCompare(b.name));
  const excess = rows.filter(r => r.variance > 0)
    .sort((a, b) => Math.abs(b.valueImpact) - Math.abs(a.valueImpact) || a.name.localeCompare(b.name));

  const totals = {
    shortageValue: shortages.reduce((s, r) => s + r.valueImpact, 0),
    excessValue: excess.reduce((s, r) => s + r.valueImpact, 0),
  };

  return { rows, shortages, excess, totals };
}
