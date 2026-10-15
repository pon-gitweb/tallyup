// Tests for the --from-stored repair path in scripts/admin/repair-snapshot-baseline.js.
// We test the pure helpers (productKey, aggregateAreaItemsToProducts, toProductItemsForRepair)
// via module.exports since the script is plain JS.

const {
  productKey,
  aggregateAreaItemsToProducts,
  toProductItemsForRepair,
  repairItems,
  resolveProductChainJs,
  buildRawItemsFromStoredSync,
} = require('../../../../scripts/admin/repair-snapshot-baseline.js');

// ── productKey ────────────────────────────────────────────────────────────────

describe('repair script productKey', () => {
  it('returns productId when present in live set', () => {
    expect(productKey({ productId: 'prod-1', name: 'Beer' }, new Set(['prod-1']))).toBe('prod-1');
  });

  it('falls back to normalised name when no live set (stale id safety)', () => {
    // Without a live set, stale area-row ids must not become grouping keys
    expect(productKey({ productId: 'prod-1', name: 'Beer' })).toBe('beer');
  });

  it('falls back to normalised name when no productId', () => {
    expect(productKey({ name: 'Pinot Noir' })).toBe('pinot noir');
  });

  it('collapses multiple spaces in name', () => {
    expect(productKey({ name: 'Gin  1L' })).toBe('gin 1l');
  });

  it('does NOT use _id as productId fallback', () => {
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

// ── Spec test 6: repair dry-run on a fixture has 0 name duplicates ────────────

describe('aggregateAreaItemsToProducts', () => {
  it('spec test 6: 3 area rows, same live productId → 0 name duplicates, correct sum', () => {
    const liveIds = new Set(['prod-ac']);
    const rawItems = [
      { _id: 'prod-ac', _areaId: 'a1', _areaName: 'Bar',    productId: 'prod-ac', name: 'André Clouet', lastCount: 3, costPrice: 60 },
      { _id: 'prod-ac', _areaId: 'a2', _areaName: 'Cellar', productId: 'prod-ac', name: 'André Clouet', lastCount: 5, costPrice: 60 },
      { _id: 'prod-ac', _areaId: 'a3', _areaName: 'Fridge', productId: 'prod-ac', name: 'André Clouet', lastCount: 2, costPrice: 60 },
    ];
    const { products, areaRowCount, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(nameDuplicates).toBe(0);
    expect(areaRowCount).toBe(3);
    expect(products).toHaveLength(1);
    expect(products[0].actualClosing).toBe(10); // 3 + 5 + 2
    expect(products[0].areas).toHaveLength(3);
  });

  it('André Clouet spec: 4 rows (1 live + 3 stale), same name → 1 item with live productId', () => {
    const liveIds = new Set(['eK07Fw']);
    const rawItems = [
      { _id: 'eK07Fw', _areaId: 'a1', _areaName: 'Back Bar',     productId: 'eK07Fw', name: 'André Clouet', lastCount: 3 },
      { _id: 'stale1', _areaId: 'a2', _areaName: 'Kitchen',       productId: 'stale1', name: 'André Clouet', lastCount: 2 },
      { _id: 'stale2', _areaId: 'a3', _areaName: 'Fridge',        productId: 'stale2', name: 'André Clouet', lastCount: 4 },
      { _id: 'stale3', _areaId: 'a4', _areaName: 'Fruit fridge',  productId: 'stale3', name: 'André Clouet', lastCount: 1 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(nameDuplicates).toBe(0);
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe('eK07Fw');
    expect(products[0].actualClosing).toBe(10); // 3+2+4+1
    expect(products[0].areas).toHaveLength(4);
    // areaItemId stored on each area entry so the original area row can be traced
    expect(products[0].areas[0].areaItemId).toBe('eK07Fw');
    expect(products[0].areas[1].areaItemId).toBe('stale1');
  });

  it('two different names → two items, 0 name duplicates', () => {
    const liveIds = new Set(['pid-a']);
    const rawItems = [
      { _id: 'pid-a', _areaId: 'a1', productId: 'pid-a', name: 'Product A', lastCount: 5 },
      { _id: 'stale', _areaId: 'a2', productId: 'stale', name: 'Product B', lastCount: 3 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(nameDuplicates).toBe(0);
    expect(products).toHaveLength(2);
  });

  it('distinct products keep separate entries, 0 name duplicates', () => {
    const liveIds = new Set(['p1', 'p2', 'p3']);
    const rawItems = [
      { _id: 'p1', productId: 'p1', name: 'Beer',  lastCount: 5 },
      { _id: 'p2', productId: 'p2', name: 'Wine',  lastCount: 3 },
      { _id: 'p3', productId: 'p3', name: 'Vodka', lastCount: 2 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(nameDuplicates).toBe(0);
    expect(products).toHaveLength(3);
  });

  it('product appearing in 2 areas: one product entry, sum correct', () => {
    const rawItems = [
      { _id: 'px', _areaId: 'a1', _areaName: 'Bar',    name: 'Gin', lastCount: 4 },
      { _id: 'px', _areaId: 'a2', _areaName: 'Cellar', name: 'Gin', lastCount: 6 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems);
    expect(nameDuplicates).toBe(0);
    expect(products[0].actualClosing).toBe(10);
  });

  it('legacy: without liveProductIds, groups by normalised name only', () => {
    const rawItems = [
      { _id: 'p-id', _areaId: 'a1', productId: 'p-id', name: 'Beer', lastCount: 4 },
      { _id: 'p-id', _areaId: 'a2', productId: 'p-id', name: 'Beer', lastCount: 6 },
    ];
    const { products } = aggregateAreaItemsToProducts(rawItems); // no liveProductIds
    expect(products).toHaveLength(1);
    expect(products[0].actualClosing).toBe(10);
    expect(products[0].productId).toBeNull(); // no live id confirmed
  });
});

// ── aggregateAreaItemsToProducts: chain resolution + ambiguity ────────────────

describe('aggregateAreaItemsToProducts — chain resolution', () => {
  it('3-step chain A→B→C: all rows group under survivor C', () => {
    const resolvedIdById = { 'A': 'C', 'B': 'C', 'C': 'C' };
    const liveIds = new Set(['C']);
    const rawItems = [
      { _id: 'rA', _areaId: 'a1', _areaName: 'Bar',    productId: 'A', name: 'Foo', lastCount: 3 },
      { _id: 'rB', _areaId: 'a2', _areaName: 'Cellar', productId: 'B', name: 'Foo', lastCount: 2 },
      { _id: 'rC', _areaId: 'a3', _areaName: 'Fridge', productId: 'C', name: 'Foo', lastCount: 5 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds, resolvedIdById);
    expect(nameDuplicates).toBe(0);
    expect(products).toHaveLength(1);
    expect(products[0].productId).toBe('C');
    expect(products[0].actualClosing).toBe(10); // 3+2+5
    expect(products[0].areas).toHaveLength(3);
  });
});

describe('aggregateAreaItemsToProducts — ambiguous name', () => {
  it('two distinct survivors with same name → 2 items, nameDuplicates=1, no abort', () => {
    const liveIds = new Set(['prod-a', 'prod-b']);
    const rawItems = [
      { _id: 'prod-a', _areaId: 'a1', productId: 'prod-a', name: 'Champagne', lastCount: 3 },
      { _id: 'prod-b', _areaId: 'a2', productId: 'prod-b', name: 'Champagne', lastCount: 5 },
    ];
    const { products, nameDuplicates } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(products).toHaveLength(2);
    expect(nameDuplicates).toBe(1); // informational count, not an abort condition
    // Both have live productIds — not ambiguous
    expect(products.find(p => p.productId === 'prod-a')?.varianceReliable).toBe(true);
    expect(products.find(p => p.productId === 'prod-b')?.varianceReliable).toBe(true);
  });

  it('ambiguous name (2 survivors) + unlinked row → 3 items, unlinked has varianceReliable false', () => {
    const liveIds = new Set(['prod-a', 'prod-b']);
    const rawItems = [
      { _id: 'prod-a',   _areaId: 'a1', productId: 'prod-a', name: 'Champagne', lastCount: 3 },
      { _id: 'prod-b',   _areaId: 'a2', productId: 'prod-b', name: 'Champagne', lastCount: 5 },
      { _id: 'unlinked', _areaId: 'a3', productId: null,     name: 'Champagne', lastCount: 2 },
    ];
    const { products } = aggregateAreaItemsToProducts(rawItems, liveIds);
    expect(products).toHaveLength(3);
    const ambiguousItem = products.find(p => p.productId == null);
    expect(ambiguousItem).toBeDefined();
    expect(ambiguousItem?.varianceReliable).toBe(false);
    expect(ambiguousItem?.ambiguousName).toBe(true);
    // Linked items are not ambiguous
    expect(products.find(p => p.productId === 'prod-a')?.varianceReliable).toBe(true);
    expect(products.find(p => p.productId === 'prod-b')?.varianceReliable).toBe(true);
  });
});

// ── resolveProductChainJs ─────────────────────────────────────────────────────

describe('resolveProductChainJs', () => {
  it('3-step chain collapses to survivor', () => {
    const prodById = {
      'A': { name: 'a', mergedInto: 'B' },
      'B': { name: 'b', mergedInto: 'C' },
      'C': { name: 'c', mergedInto: null },
    };
    expect(resolveProductChainJs('A', prodById)).toBe('C');
    expect(resolveProductChainJs('C', prodById)).toBe('C');
  });

  it('cycle detected: returns null', () => {
    const prodById = {
      'A': { mergedInto: 'B' },
      'B': { mergedInto: 'A' },
    };
    expect(resolveProductChainJs('A', prodById)).toBeNull();
  });

  it('missing doc in chain: returns null', () => {
    expect(resolveProductChainJs('A', { 'A': { mergedInto: 'B' } })).toBeNull();
  });
});

// ── buildRawItemsFromStoredSync ───────────────────────────────────────────────

describe('buildRawItemsFromStoredSync', () => {
  it('uses stored actualClosing as lastCount, live productId from liveItemsById', () => {
    const storedItems = [{
      name: 'Beer',
      areas: [{ areaId: 'a1', areaItemId: 'item-1', areaName: 'Bar', actualClosing: 10 }],
    }];
    const liveItemsById = new Map([['item-1', 'prod-beer']]);
    const { rawItems, noLiveItemCount } = buildRawItemsFromStoredSync(storedItems, liveItemsById);
    expect(rawItems).toHaveLength(1);
    expect(rawItems[0].lastCount).toBe(10);    // stored count, not live
    expect(rawItems[0].productId).toBe('prod-beer'); // live productId
    expect(noLiveItemCount).toBe(0);
  });

  it('stored row with no live item gets null productId and increments noLiveItemCount', () => {
    const storedItems = [{
      name: 'Wine',
      areas: [{ areaId: 'a1', areaItemId: 'missing-item', areaName: 'Bar', actualClosing: 5 }],
    }];
    const liveItemsById = new Map(); // no live items
    const { rawItems, noLiveItemCount } = buildRawItemsFromStoredSync(storedItems, liveItemsById);
    expect(rawItems[0].productId).toBeNull();
    expect(noLiveItemCount).toBe(1);
  });

  it('live item with null productId: passes null through as liveProductId', () => {
    const storedItems = [{
      name: 'Gin',
      areas: [{ areaId: 'a1', areaItemId: 'item-x', areaName: 'Bar', actualClosing: 3 }],
    }];
    const liveItemsById = new Map([['item-x', null]]); // live item exists but has no productId
    const { rawItems, noLiveItemCount } = buildRawItemsFromStoredSync(storedItems, liveItemsById);
    expect(rawItems[0].productId).toBeNull();
    expect(noLiveItemCount).toBe(0); // live item found, even if productId is null
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
