import { productKey, toProductItems } from '../productSnapshotItems';

// ── productKey ────────────────────────────────────────────────────────────────

describe('productKey', () => {
  it('returns productId when present in live set', () => {
    expect(productKey({ productId: 'prod-001', name: 'Beer' }, new Set(['prod-001']))).toBe('prod-001');
  });

  it('falls back to normalised name when no live set provided (stale id safety)', () => {
    // Without a live set, productKey must never use productId alone — stale area-row
    // doc ids would become incorrect grouping keys.
    expect(productKey({ productId: 'prod-001', name: 'Beer' })).toBe('beer');
  });

  it('falls back to normalised name when productId absent', () => {
    expect(productKey({ name: 'André Clouet' })).toBe('andré clouet');
  });

  it('normalises name (lowercase + trim)', () => {
    expect(productKey({ name: '  BEER  ' })).toBe('beer');
  });

  it('collapses multiple spaces in name', () => {
    expect(productKey({ name: 'Gin  1L' })).toBe('gin 1l');
  });

  it('returns empty string for item with no productId or name', () => {
    expect(productKey({})).toBe('');
  });
});

// ── toProductItems: granularity === 'product' ─────────────────────────────────

describe('toProductItems — granularity product', () => {
  it('returns items as-is when granularity is product', () => {
    const items = [{ productId: 'p1', name: 'Beer', actualClosing: 5, varianceReliable: true }];
    expect(toProductItems(items, 'product')).toBe(items);
  });
});

// ── Spec test 1: product in 3 areas → one item, actual = sum ─────────────────

describe('toProductItems — spec test 1: product in 3 areas', () => {
  const items = [
    { productId: 'prod-ac', name: 'André Clouet', areaId: 'a1', areaName: 'Bar',    actualClosing: 3 },
    { productId: 'prod-ac', name: 'André Clouet', areaId: 'a2', areaName: 'Cellar', actualClosing: 5 },
    { productId: 'prod-ac', name: 'André Clouet', areaId: 'a3', areaName: 'Fridge', actualClosing: 2 },
  ];

  it('collapses 3 area rows to 1 product item', () => {
    const result = toProductItems(items);
    expect(result).toHaveLength(1);
  });

  it('sums actualClosing across all areas', () => {
    const result = toProductItems(items);
    expect(result[0].actualClosing).toBe(10); // 3 + 5 + 2
  });

  it('sets varianceReliable: false for multi-area product', () => {
    const result = toProductItems(items);
    expect(result[0].varianceReliable).toBe(false);
  });

  it('nulls out all variance/baseline fields', () => {
    const withVariance = [
      { ...items[0], openingCount: 8, expectedClosing: 8, totalVarianceQty: -5, totalVarianceDollars: -25,
        unexplainedVarianceQty: -5, unexplainedVarianceDollars: -25,
        displayTotalVarianceDollars: -25, displayUnexplainedVarianceDollars: -25 },
      ...items.slice(1),
    ];
    const result = toProductItems(withVariance);
    expect(result[0].openingCount).toBeNull();
    expect(result[0].expectedClosing).toBeNull();
    expect(result[0].totalVarianceQty).toBeNull();
    expect(result[0].totalVarianceDollars).toBeNull();
    expect(result[0].unexplainedVarianceQty).toBeNull();
    expect(result[0].unexplainedVarianceDollars).toBeNull();
    expect(result[0].displayTotalVarianceDollars).toBeNull();
    expect(result[0].displayUnexplainedVarianceDollars).toBeNull();
  });

  it('builds areas breakdown with one entry per area', () => {
    const result = toProductItems(items);
    expect(result[0].areas).toHaveLength(3);
    expect(result[0].areas[0]).toMatchObject({ areaId: 'a1', areaName: 'Bar', actualClosing: 3 });
    expect(result[0].areas[1]).toMatchObject({ areaId: 'a2', areaName: 'Cellar', actualClosing: 5 });
    expect(result[0].areas[2]).toMatchObject({ areaId: 'a3', areaName: 'Fridge', actualClosing: 2 });
  });

  it('joins distinct area names in product areaName', () => {
    const result = toProductItems(items);
    expect(result[0].areaName).toContain('Bar');
    expect(result[0].areaName).toContain('Cellar');
    expect(result[0].areaName).toContain('Fridge');
  });
});

// ── Spec test 2: stock moved between areas — zero variance ────────────────────

describe('toProductItems — spec test 2: stock moved between areas', () => {
  it('same total across areas still sums correctly (zero net variance possible)', () => {
    // Before: 4 in Bar, 0 in Cellar. After: 2 in Bar, 2 in Cellar. Total = 4.
    const items = [
      { name: 'Whisky', areaId: 'a1', areaName: 'Bar',    actualClosing: 2 },
      { name: 'Whisky', areaId: 'a2', areaName: 'Cellar', actualClosing: 2 },
    ];
    const result = toProductItems(items);
    expect(result[0].actualClosing).toBe(4);
    // With openingCount = 4 from prev cycle, variance would be 0
  });
});

// ── Spec test 3: legacy loader — multi-area unreliable, single-area reliable ──

describe('toProductItems — spec test 3: legacy reliability marking', () => {
  const items = [
    { name: 'Champagne', areaId: 'a1', areaName: 'Bar',    actualClosing: 3 },
    { name: 'Champagne', areaId: 'a2', areaName: 'Cellar', actualClosing: 5 },
    { name: 'Beer',      areaId: 'a1', areaName: 'Bar',    actualClosing: 12 },
  ];

  it('multi-area product is varianceReliable: false', () => {
    const result = toProductItems(items);
    const cham = result.find((i: any) => i.name === 'Champagne');
    expect(cham!.varianceReliable).toBe(false);
  });

  it('single-area product is varianceReliable: true', () => {
    const result = toProductItems(items);
    const beer = result.find((i: any) => i.name === 'Beer');
    expect(beer!.varianceReliable).toBe(true);
  });

  it('single-area product keeps its existing fields unchanged', () => {
    const withFields = [
      ...items.slice(0, 2),
      { name: 'Beer', areaId: 'a1', areaName: 'Bar', actualClosing: 12,
        openingCount: 10, totalVarianceQty: 2, costPrice: 3.5 },
    ];
    const result = toProductItems(withFields);
    const beer = result.find((i: any) => i.name === 'Beer');
    expect(beer!.openingCount).toBe(10);
    expect(beer!.totalVarianceQty).toBe(2);
    expect(beer!.costPrice).toBe(3.5);
  });

  it('granularity product bypasses grouping — all items returned as-is', () => {
    const result = toProductItems(items, 'product');
    expect(result).toBe(items); // same reference
    expect(result).toHaveLength(3);
  });
});

// ── Spec test 4: productId-keyed grouping (two areas, same productId) ─────────

describe('toProductItems — productId as grouping key', () => {
  it('groups two area rows with same productId but different names into one product', () => {
    const items = [
      { productId: 'p-wine', name: 'Wine (Red)',  areaId: 'a1', areaName: 'Bar',    actualClosing: 4 },
      { productId: 'p-wine', name: 'Wine (Red)',  areaId: 'a2', areaName: 'Cellar', actualClosing: 6 },
    ];
    const result = toProductItems(items);
    expect(result).toHaveLength(1);
    expect(result[0].actualClosing).toBe(10);
    expect(result[0].varianceReliable).toBe(false);
  });

  it('keeps distinct productIds as separate products even with same name (with live set)', () => {
    const items = [
      { productId: 'p-beer-a', name: 'Beer', areaId: 'a1', actualClosing: 5 },
      { productId: 'p-beer-b', name: 'Beer', areaId: 'a2', actualClosing: 3 },
    ];
    const liveIds = new Set(['p-beer-a', 'p-beer-b']);
    const result = toProductItems(items, undefined, liveIds);
    expect(result).toHaveLength(2);
  });

  it('without live set, same-name rows always group together regardless of productId', () => {
    const items = [
      { productId: 'p-beer-a', name: 'Beer', areaId: 'a1', actualClosing: 5 },
      { productId: 'p-beer-b', name: 'Beer', areaId: 'a2', actualClosing: 3 },
    ];
    const result = toProductItems(items);
    expect(result).toHaveLength(1);
    expect(result[0].actualClosing).toBe(8);
  });
});

// ── Spec test 5: areas[] structure ───────────────────────────────────────────

describe('toProductItems — areas[] breakdown structure', () => {
  it('single-area item gets areas with correct fields', () => {
    const items = [
      { name: 'Gin', areaId: 'z1', areaName: 'Garage',
        actualClosing: 7, lastCountAt: 1234567890, lastCountBy: 'uid-1', lastCountByName: 'Alice' },
    ];
    const result = toProductItems(items);
    expect(result[0].areas).toHaveLength(1);
    expect(result[0].areas[0]).toMatchObject({
      areaId: 'z1',
      areaName: 'Garage',
      actualClosing: 7,
      lastCountAt: 1234567890,
      lastCountBy: 'uid-1',
      lastCountByName: 'Alice',
    });
  });
});

// ── Spec test 6: empty and edge cases ────────────────────────────────────────

describe('toProductItems — edge cases', () => {
  it('empty array returns empty array', () => {
    expect(toProductItems([])).toEqual([]);
    expect(toProductItems([], 'product')).toEqual([]);
  });

  it('items with no name and no productId all group under empty key', () => {
    const items = [
      { actualClosing: 2 },
      { actualClosing: 3 },
    ];
    const result = toProductItems(items);
    // Both share key '' — multi-area, summed
    expect(result).toHaveLength(1);
    expect(result[0].actualClosing).toBe(5);
    expect(result[0].varianceReliable).toBe(false);
  });
});
