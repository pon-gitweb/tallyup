// Normalise a product name for grouping: lowercase, trim, collapse runs of
// whitespace to a single space.  Applied consistently in productKey and the
// writer's aggregation step so "Gin  1L" and "Gin 1L" map to the same key.
export function normaliseName(name: string): string {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Stable grouping key for a snapshot item.
// Uses productId when present; falls back to normalised name.
export function productKey(item: any): string {
  const pid = typeof item.productId === 'string' && item.productId ? item.productId : null;
  if (pid) return pid;
  return normaliseName(item.name);
}

// Aggregate per-area snapshot items to product-level.
//
// granularity === 'product': items are already product-level — return as-is.
// granularity === undefined (legacy per-area rows): group by productKey.
//   Single-area product: keep all fields, add areas array, set varianceReliable: true.
//   Multi-area product: sum actualClosing, null all variance/baseline fields,
//   set varianceReliable: false (legacy per-area rows cannot give a reliable baseline).
export function toProductItems(items: any[], granularity?: string): any[] {
  if (granularity === 'product') return items;

  const grouped = new Map<string, any[]>();
  for (const item of items) {
    const key = productKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const result: any[] = [];
  for (const [, rows] of grouped) {
    const base = rows[0];
    const areas = rows.map(r => ({
      areaId: r.areaId ?? null,
      areaName: r.areaName ?? null,
      actualClosing: typeof r.actualClosing === 'number' ? r.actualClosing : 0,
      lastCountAt: r.lastCountAt ?? null,
      lastCountBy: r.lastCountBy ?? null,
      lastCountByName: r.lastCountByName ?? null,
    }));
    const actualClosing = areas.reduce((s, a) => s + a.actualClosing, 0);
    const distinctAreaNames = [...new Set(areas.map((a: any) => a.areaName).filter(Boolean))];
    const areaName = distinctAreaNames.join(', ') || base.areaName || null;

    if (rows.length === 1) {
      result.push({ ...base, areaName, areas, varianceReliable: true });
    } else {
      result.push({
        ...base,
        actualClosing,
        areaName,
        areas,
        openingCount: null,
        expectedClosing: null,
        totalVarianceQty: null,
        totalVarianceDollars: null,
        unexplainedVarianceQty: null,
        unexplainedVarianceDollars: null,
        displayTotalVarianceDollars: null,
        displayUnexplainedVarianceDollars: null,
        varianceReliable: false,
      });
    }
  }
  return result;
}
