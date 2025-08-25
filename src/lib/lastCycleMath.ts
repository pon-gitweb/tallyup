export type CycleItemLike = {
  id?: string;
  name?: string;
  // Counted amount captured at cycle completion
  count?: number;
  quantity?: number;
  qty?: number;

  // Target / par level at time of cycle (ideally snapshotted)
  par?: number;
  parLevel?: number;

  // Cost basis captured at time of cycle (ideally snapshotted)
  costPrice?: number;
  price?: number;
};

export type VarianceRow = {
  id: string;
  name: string;
  par: number;
  count: number;
  diffUnits: number;      // count - par (negative = shortage)
  valueImpact: number;    // diffUnits * costPrice (NZD)
};

export type LastCycleSummary = {
  totalItemsCounted: number;
  totalShortageValue: number;  // positive number (absolute)
  totalExcessValue: number;    // positive number
  netValueImpact: number;      // signed
  topVariances: VarianceRow[]; // sorted by |valueImpact| desc
};

function num(n: unknown, d: number = 0): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : d;
}

export function normalizeItem(raw: CycleItemLike): VarianceRow {
  const par = num(raw.par ?? raw.parLevel, 0);
  const count = num(raw.count ?? raw.quantity ?? raw.qty, 0);
  const cost = num(raw.costPrice ?? raw.price, 0);
  const diffUnits = count - par;
  const valueImpact = diffUnits * cost;

  return {
    id: raw.id ?? '',
    name: raw.name ?? 'Unnamed item',
    par,
    count,
    diffUnits,
    valueImpact,
  };
}

export function computeLastCycleSummary(items: CycleItemLike[], topN = 10): LastCycleSummary {
  const rows = items.map(normalizeItem);

  let totalShortageValue = 0;
  let totalExcessValue = 0;
  let netValueImpact = 0;

  for (const r of rows) {
    netValueImpact += r.valueImpact;
    if (r.diffUnits < 0) totalShortageValue += Math.abs(r.valueImpact);
    if (r.diffUnits > 0) totalExcessValue += r.valueImpact;
  }

  const topVariances = [...rows]
    .sort((a, b) => Math.abs(b.valueImpact) - Math.abs(a.valueImpact))
    .slice(0, topN);

  return {
    totalItemsCounted: rows.length,
    totalShortageValue,
    totalExcessValue,
    netValueImpact,
    topVariances,
  };
}
