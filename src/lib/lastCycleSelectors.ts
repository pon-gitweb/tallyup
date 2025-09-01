export type VarianceRow = { name: string; variance: number; valueImpact?: number | null };

export function pickTopVariances(rows: VarianceRow[], n = 5): VarianceRow[] {
  const scored = rows.map(r => ({
    ...r,
    _score: (r.valueImpact != null) ? Math.abs(Number(r.valueImpact)) : Math.abs(Number(r.variance) || 0),
  }));
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, n).map(({ _score, ...rest }) => rest);
}
