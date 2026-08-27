// Tests for startNewDepartmentCycle Phase P3b additions:
//   Pass 1 — item price refresh (sync item.costPrice to product.costPrice)
//   Pass 2 — product quantity-basis correction (physical_count from lastCount)
//
// Covered scenarios:
//   (a) item whose price differs from its product is refreshed; one that
//       already matches is counted as alreadyCurrent, not refreshed
//   (b) a merged/inactive product resolves to the active survivor via
//       resolveProduct, not by name-matching
//   (c) an item with no productId, or one pointing at a missing product,
//       is skipped without error and not counted in either bucket
//   (d) lastCount is summed correctly across two items in different areas
//       of the same department (both map to the same product)
//   (e) the basis-correction pass (Pass 2) does NOT write costPrice

// ── Firebase mock ─────────────────────────────────────────────────────────────
// Must appear before any imports to prevent the module-level Firestore init
// inside the service from requiring a live Firebase app.
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../activeDeptTake', () => ({
  ensureDeptSessionActive: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  doc: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  getDocs: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
  writeBatch: jest.fn(),
  serverTimestamp: jest.fn(() => '__ts__'),
}));

import { startNewDepartmentCycle } from '../cycles';
import * as firestore from 'firebase/firestore';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VENUE = 'v1';
const DEPT = 'dept-1';

function makeSnap(docs: any[]) {
  return {
    docs,
    empty: docs.length === 0,
    forEach: (fn: (d: any) => void) => docs.forEach(fn),
  };
}

function makeAreaDoc(id: string) {
  return { id, data: () => ({}) };
}

/** A mock area-item document with a Firestore-style ref. */
function makeItem(id: string, areaId: string, data: Record<string, any>) {
  return {
    id,
    ref: { _path: `venues/${VENUE}/departments/${DEPT}/areas/${areaId}/items/${id}` },
    data: () => data,
  };
}

/** A mock product document (for getDocs on the products collection). */
function makeProduct(id: string, data: Record<string, any>) {
  return { id, data: () => data };
}

// ── Suite (a): item price refresh ─────────────────────────────────────────────

describe('startNewDepartmentCycle — item price refresh (Pass 1)', () => {
  let batchUpdate: jest.Mock;
  let batchCommit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    batchCommit = jest.fn().mockResolvedValue(undefined);
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      commit: batchCommit,
    });
  });

  it('refreshes an item whose costPrice differs from its product and increments itemsPriceRefreshed', async () => {
    const item = makeItem('item-1', 'area-1', { productId: 'prod-1', costPrice: 5, lastCount: 10 });
    const product = makeProduct('prod-1', { name: 'Widget', costPrice: 10, active: true });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([product]);
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await startNewDepartmentCycle(VENUE, DEPT);

    expect(result.itemsPriceRefreshed).toBe(1);
    expect(result.itemsAlreadyCurrent).toBe(0);

    // Two batchUpdate calls reach item-1: the incomingQty/soldQty write from
    // startNewDepartmentCycle's own item loop, then the price-refresh write from
    // refreshPricesForDepartment. Find the latter by the presence of costPrice.
    const itemCall = batchUpdate.mock.calls.find(([ref, data]: any[]) =>
      ref._path.includes('/items/item-1') && data.costPrice !== undefined,
    );
    expect(itemCall).toBeDefined();
    expect(itemCall![1].costPrice).toBe(10);
    expect(itemCall![1].previousCostPrice).toBe(5);
    expect(itemCall![1].costPriceSource).toBe('cycle_reset');
    expect(itemCall![1].costPriceRefreshedAt).toBe('__ts__');
    // incomingQty/soldQty are in the separate cycles.ts batch, not this write
    expect(itemCall![1].incomingQty).toBeUndefined();
  });

  it('leaves an item whose costPrice already matches and counts it as alreadyCurrent', async () => {
    const item = makeItem('item-1', 'area-1', { productId: 'prod-1', costPrice: 10, lastCount: 8 });
    const product = makeProduct('prod-1', { name: 'Widget', costPrice: 10, active: true });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([product]);
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await startNewDepartmentCycle(VENUE, DEPT);

    expect(result.itemsPriceRefreshed).toBe(0);
    expect(result.itemsAlreadyCurrent).toBe(1);

    const itemCall = batchUpdate.mock.calls.find(([ref]: any[]) =>
      ref._path.includes('/items/item-1'),
    );
    expect(itemCall).toBeDefined();
    // No costPrice written when already current
    expect(itemCall![1].costPrice).toBeUndefined();
    expect(itemCall![1].incomingQty).toBe(0);
    expect(itemCall![1].soldQty).toBe(0);
  });
});

// ── Suite (b): merge-chain resolution ────────────────────────────────────────

describe('startNewDepartmentCycle — merged product resolution (Pass 1)', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      commit: jest.fn().mockResolvedValue(undefined),
    });
  });

  it("resolves a merged product via the shared resolver and uses the survivor's costPrice", async () => {
    // item.productId points at the defunct doc; resolveProduct must walk to the survivor.
    const item = makeItem('item-1', 'area-1', {
      productId: 'prod-defunct',
      costPrice: 5,
      lastCount: 6,
    });
    const defunct = makeProduct('prod-defunct', {
      name: 'Old Widget', active: false, mergedInto: 'prod-survivor',
    });
    const survivor = makeProduct('prod-survivor', {
      name: 'Widget', costPrice: 12, active: true,
    });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([defunct, survivor]);
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await startNewDepartmentCycle(VENUE, DEPT);

    expect(result.itemsPriceRefreshed).toBe(1);
    const itemCall = batchUpdate.mock.calls.find(([ref, data]: any[]) =>
      ref._path.includes('/items/item-1') && data.costPrice !== undefined,
    );
    expect(itemCall![1].costPrice).toBe(12); // survivor's price, not defunct's
  });
});

// ── Suite (c): unlinked / missing product ────────────────────────────────────

describe('startNewDepartmentCycle — unlinked or missing product (Pass 1)', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      commit: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('skips an item with no productId without error; still zeros incomingQty/soldQty', async () => {
    const item = makeItem('item-1', 'area-1', { costPrice: 5, lastCount: 3 }); // no productId

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([]);
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await startNewDepartmentCycle(VENUE, DEPT);

    expect(result.itemsPriceRefreshed).toBe(0);
    expect(result.itemsAlreadyCurrent).toBe(0);
    const itemCall = batchUpdate.mock.calls.find(([ref]: any[]) =>
      ref._path.includes('/items/item-1'),
    );
    expect(itemCall![1].incomingQty).toBe(0);
    expect(itemCall![1].soldQty).toBe(0);
    expect(itemCall![1].costPrice).toBeUndefined();
  });

  it('skips an item pointing at a product not in the catalogue without error', async () => {
    const item = makeItem('item-1', 'area-1', {
      productId: 'prod-ghost',
      costPrice: 5,
      lastCount: 2,
    });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([]); // ghost product not present
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await startNewDepartmentCycle(VENUE, DEPT);

    expect(result.itemsPriceRefreshed).toBe(0);
    expect(result.itemsAlreadyCurrent).toBe(0);
    const itemCall = batchUpdate.mock.calls.find(([ref]: any[]) =>
      ref._path.includes('/items/item-1'),
    );
    expect(itemCall![1].incomingQty).toBe(0);
    expect(itemCall![1].costPrice).toBeUndefined();
  });
});

// ── Suite (d + e): product-level basis correction ────────────────────────────

describe('startNewDepartmentCycle — product quantity-basis correction (Pass 2)', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      commit: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('(d) sums lastCount across two items in different areas for the same product', async () => {
    const item1 = makeItem('item-1', 'area-1', { productId: 'prod-1', costPrice: 10, lastCount: 10 });
    const item2 = makeItem('item-2', 'area-2', { productId: 'prod-1', costPrice: 10, lastCount: 5 });
    const product = makeProduct('prod-1', { name: 'Widget', costPrice: 10, active: true });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1'), makeAreaDoc('area-2')]);
      if (p.endsWith('/products')) return makeSnap([product]);
      if (p.includes('area-1/items')) return makeSnap([item1]);
      if (p.includes('area-2/items')) return makeSnap([item2]);
      return makeSnap([]);
    });

    await startNewDepartmentCycle(VENUE, DEPT);

    const basisCall = batchUpdate.mock.calls.find(([ref]: any[]) =>
      ref._path.includes('/products/prod-1'),
    );
    expect(basisCall).toBeDefined();
    expect(basisCall![1].costPriceQuantityBasis).toBe(15); // 10 + 5
    expect(basisCall![1].quantityConfidence).toBe('physical_count');
    expect(basisCall![1].costPriceBasisAt).toBe('__ts__');
  });

  it('(e) the basis-correction pass never writes costPrice to the product', async () => {
    const item = makeItem('item-1', 'area-1', { productId: 'prod-1', costPrice: 10, lastCount: 7 });
    const product = makeProduct('prod-1', { name: 'Widget', costPrice: 10, active: true });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/areas')) return makeSnap([makeAreaDoc('area-1')]);
      if (p.endsWith('/products')) return makeSnap([product]);
      if (p.includes('/items')) return makeSnap([item]);
      return makeSnap([]);
    });

    await startNewDepartmentCycle(VENUE, DEPT);

    const basisCall = batchUpdate.mock.calls.find(([ref]: any[]) =>
      ref._path.includes('/products/prod-1'),
    );
    expect(basisCall).toBeDefined();
    // costPrice must be absent — Pass 2 corrects the quantity basis only.
    expect(basisCall![1].costPrice).toBeUndefined();
  });
});
