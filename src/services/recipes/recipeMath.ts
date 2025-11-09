/**
 * CraftUp recipe math utilities (no side-effects).
 * Supports:
 * - inventory items (deduct = true)
 * - free/non-deducted items like ice/water (deduct = false, cost 0)
 * - mixers/juices/syrups with volume + optional cost
 * - nested batches (sourceType='batch', nestedRecipeId)
 * - unit conversions (ml/L, g/kg, tsp/Tbsp)
 * - optional density for g<->ml conversion when needed (defaults 1.0)
 * - beverage ABV estimate if item.abvPct provided
 */

export type RecipeItem = {
  // Where this line comes from
  sourceType: 'inventory' | 'free' | 'batch';
  name: string;
  // For inventory items
  productId?: string | null;
  // For nested batch
  nestedRecipeId?: string | null;

  // Quantity & unit
  qty: number;                // e.g., 30
  unit: 'ml'|'l'|'g'|'kg'|'tsp'|'tbsp'|'dash'|'piece'|'unit'; // keep small & predictable
  density?: number | null;    // g/ml for conversions when unit is weight but we need volume

  // Economics & behaviour
  costPerUnit?: number | null; // fallback if inventory link missing (cost per unit, same unit scale)
  priceOverride?: number | null;// explicit cost for the whole line (overrides computed)
  deduct?: boolean;           // default true for inventory/batch; false for free items like ice/water

  // Beverage only (optional)
  abvPct?: number | null;     // 40 means 40% ABV for spirits
};

export type RecipeDoc = {
  name: string;
  status: 'draft'|'confirmed';
  category?: 'food'|'beverage'|null;
  mode?: 'batch'|'single'|'dish'|null;
  yield?: number | null;      // e.g., 4 serves (for batch/dish)
  unit?: string | null;       // e.g., 'serves', 'ml', etc.
  items: RecipeItem[];
  cogs?: number | null;
  rrp?: number | null;
  method?: string | null;
};

// ------------ Unit helpers ------------
const ML_PER_L = 1000;
const G_PER_KG = 1000;
const ML_PER_TSP = 5;
const ML_PER_TBSP = 15;
const ML_PER_DASH = 0.9; // heuristic

function toMl(qty: number, unit: RecipeItem['unit'], density: number | null | undefined): number {
  const q = Number(qty) || 0;
  switch (unit) {
    case 'ml': return q;
    case 'l': return q * ML_PER_L;
    case 'tsp': return q * ML_PER_TSP;
    case 'tbsp': return q * ML_PER_TBSP;
    case 'dash': return q * ML_PER_DASH;
    case 'piece':
    case 'unit':
      // pieces have no inherent volume; treat as 0 ml unless density supplied
      return 0;
    case 'g':
      // Need density (g/ml). If missing, assume water=1.0
      return q / (density || 1.0);
    case 'kg':
      return (q * G_PER_KG) / (density || 1.0);
    default:
      return 0;
  }
}

function costForLine(it: RecipeItem): number {
  // priceOverride wins
  if (it.priceOverride != null) return Number(it.priceOverride) || 0;
  const cpu = Number(it.costPerUnit ?? 0);
  // If costPerUnit is per provided unit, multiply by qty
  return cpu * (Number(it.qty) || 0);
}

// Alcohol ml for beverage lines with abvPct
function alcoholMl(it: RecipeItem): number {
  if (!it.abvPct) return 0;
  const volMl = toMl(it.qty, it.unit, it.density);
  return volMl * (Number(it.abvPct) / 100);
}

// ------------ Public API ------------
export type Totals = {
  totalCost: number;
  totalVolumeMl: number;
  totalAlcoholMl: number;
  abvPct: number;              // if beverage & volume > 0
  perServeCost: number | null; // if yield provided
  perServeVolumeMl: number | null;
};

export function computeRecipeTotals(doc: RecipeDoc): Totals {
  const items = Array.isArray(doc.items) ? doc.items : [];
  let totalCost = 0;
  let totalVolumeMl = 0;
  let totalAlcoholMl = 0;

  for (const it of items) {
    // Economics
    totalCost += costForLine(it);

    // Volumes: always compute so we can show per-serve volume (beverage and food liquids)
    totalVolumeMl += toMl(it.qty, it.unit, it.density);

    // ABV
    totalAlcoholMl += alcoholMl(it);
  }

  const abvPct = totalVolumeMl > 0 ? (totalAlcoholMl / totalVolumeMl) * 100 : 0;

  const y = Number(doc.yield ?? NaN);
  const perServeCost = Number.isFinite(y) && y > 0 ? totalCost / y : null;
  const perServeVolumeMl = Number.isFinite(y) && y > 0 ? totalVolumeMl / y : null;

  return {
    totalCost: round2(totalCost),
    totalVolumeMl: round2(totalVolumeMl),
    totalAlcoholMl: round2(totalAlcoholMl),
    abvPct: round2(abvPct),
    perServeCost: perServeCost != null ? round2(perServeCost) : null,
    perServeVolumeMl: perServeVolumeMl != null ? round2(perServeVolumeMl) : null,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
