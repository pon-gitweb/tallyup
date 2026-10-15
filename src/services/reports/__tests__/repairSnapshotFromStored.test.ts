// Tests for the --from-stored repair path in scripts/admin/repair-snapshot-baseline.js.
// We test the pure helpers (productKey, aggregateAreaItemsToProducts, toProductItemsForRepair)
// via module.exports since the script is plain JS.

const {
  productKey,
  aggregateAreaItemsToProducts,
  toProductItemsForRepair,
  repairItems,
} = require('../../../../scripts/admin/repair-snapshot-baseline.js');

// ── productKey ────────────────────────────────────────────────────────────────

describe('repair script productKey', () => {
  it('returns productId when present', () => {
    expect(productKey({ productId: 'prod-1', name: 'Beer' })).toBe('prod-1');
  });

  it('falls back to normalised name when no productId', () => {
    expect(productKey({ name: 'Pinot Noir' })).toBe('pinot noir');
  });

  it('collapses multiple spaces in name', () => {
    expect(productKey({ name: 'Gin  1L' })).toBe('gin 1l');
  });

  it('does NOT use _id as productId fallback', () => {
    // _id must never become the grouping key — items without productId fall back to name
    expect(productKey({ _id: 'some-id', name: 'Vodka' })).toBe('vodka');
  });
});

// ── toProductItemsForRepair ───────────────────────────────────────────────────

describe('toProductItemsForRepair', () => {
  it('returns items as-is when granularity is product', () => {
    const items = [{ productId: 'p1', actualClosing: 5 }];
    expect(toProductItemsForRepair(items, 'product')).toBe(items);
  });

  it('aggregates multi-area rows: sum actualClosing, varianceReliable false', () => {
    const items = [
      { productId: 'p-wine', name: 'Wine', areaId: 'a1', areaName: 'Bar', actualClosing: 3 },
      { productId: 'p-wine', name: 'Wine', areaId: 'a2', areaName: 'Cellar', actualClosing: 7 },
    ];
    const result = toProductItemsForRepair(items);
    expect(result).toHaveLength(1);
    expect(result[0].actualClosing).toBe(10);
    expect(result[0].varianceReliable).toBe(false);
  });

  it('single-area product: varianceReliable true', () => {
    const items = [{ name: 'Beer', areaId: 'a1', actualClosing: 5 }];
    const result = toProductItemsForRepair(items);
    expect(result[0].varianceReliable).toBe(true);
  });
});

// ── Spec test 6: repair dry-run on a fixture has 0 duplicate keys ─────────────

describe('aggregateAreaItemsToProducts', () => {
  it('spec test 6: 3 area rows for one product → 0 duplicate keys, correct sum', () => {
    const rawItems = [
      { _id: 'prod-ac', _areaId: 'a1', _areaName: 'Bar',    productId: 'prod-ac', name: 'André Clouet', lastCount: 3, costPrice: 60 },
      { _id: 'prod-ac', _areaId: 'a2', _areaName: 'Cellar', productId: 'prod-ac', name: 'André Clouet', lastCount: 5, costPrice: 60 },
      { _id: 'prod-ac', _areaId: 'a3', _areaName: 'Fridge', productId: 'prod-ac', name: 'André Clouet', lastCount: 2, costPrice: 60 },
    ];
    const { products, areaRowCount, duplicateKeys } = aggregateAreaItemsToProducts(rawItems);
    expect(duplicateKeys).toBe(0);
    expect(areaRowCount).toBe(3);
    expect(products).toHaveLength(1);
    expect(products[0].actualClosing).toBe(10); // 3 + 5 + 2
    expect(products[0].areas).toHaveLength(3);
  });

  it('distinct products keep separate entries, 0 duplicate keys', () => {
    const rawItems = [
      { _id: 'p1', productId: 'p1', name: 'Beer',  lastCount: 5 },
      { _id: 'p2', productId: 'p2', name: 'Wine',  lastCount: 3 },
      { _id: 'p3', productId: 'p3', name: 'Vodka', lastCount: 2 },
    ];
    const { products, duplicateKeys } = aggregateAreaItemsToProducts(rawItems);
    expect(duplicateKeys).toBe(0);
    expect(products).toHaveLength(3);
  });

  it('product appearing in 2 areas: one product entry, sum correct', () => {
    const rawItems = [
      { _id: 'px', _areaId: 'a1', _areaName: 'Bar',    name: 'Gin', lastCount: 4 },
      { _id: 'px', _areaId: 'a2', _areaName: 'Cellar', name: 'Gin', lastCount: 6 },
    ];
    const { products, duplicateKeys } = aggregateAreaItemsToProducts(rawItems);
    expect(duplicateKeys).toBe(0);
    expect(products[0].actualClosing).toBe(10);
  });
});

// ── repairItems: uses baseline to compute openingCount and variance ────────────

describe('repairItems', () => {
  it('product with baseline gets correct openingCount and variance', () => {
    const target = [{ productId: 'p1', name: 'Beer', actualClosing: 8, costPrice: 5 }];
    const baseline = [{ productId: 'p1', name: 'Beer', actualClosing: 6, varianceReliable: true }];
    const result = repairItems(target, baseline, 2);
    expect(result[0].openingCount).toBe(6);
    expect(result[0].totalVarianceQty).toBe(2);
  });

  it('product not in baseline gets openingCount null, zero variance', () => {
    const target = [{ name: 'New Product', actualClosing: 5, costPrice: 10 }];
    const result = repairItems(target, [], 2);
    expect(result[0].openingCount).toBeNull();
    expect(result[0].totalVarianceQty).toBe(0);
  });
});
