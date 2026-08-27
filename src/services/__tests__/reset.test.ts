// Mock firebase modules before any imports — prevents the module-level
// Firestore/Auth init in reset.ts from requiring a live Firebase app.
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  query: jest.fn((colRef: any) => ({ ...colRef })), // preserve _path through query()
  where: jest.fn((field: string, op: string, val: string) => ({ _field: field })),
  getDocs: jest.fn(),
  getDoc: jest.fn(), // present so tests can assert it is never called after P3b refactor
  writeBatch: jest.fn(),
  doc: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  serverTimestamp: jest.fn(() => 'SERVER_TS'),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  increment: jest.fn((n: number) => ({ _increment: n })),
  deleteDoc: jest.fn(),
}));

import { shouldClearStocktakeActive, resetDepartment, resetAllDepartmentsStockTake } from '../reset';
import * as firestore from 'firebase/firestore';

// ── Suite 1: shouldClearStocktakeActive ──────────────────────────────────────

describe('shouldClearStocktakeActive', () => {
  it('returns true when all departments have all-null areas', () => {
    const areasByDept = [
      [{ startedAt: null, completedAt: null }],
      [{ startedAt: null, completedAt: null }, { startedAt: null, completedAt: null }],
    ];
    expect(shouldClearStocktakeActive(areasByDept)).toBe(true);
  });

  it('returns true for empty departments array', () => {
    expect(shouldClearStocktakeActive([])).toBe(true);
  });

  it('returns false when any area has startedAt != null', () => {
    const areasByDept = [
      [{ startedAt: null, completedAt: null }],
      [{ startedAt: 'some-timestamp', completedAt: null }],
    ];
    expect(shouldClearStocktakeActive(areasByDept)).toBe(false);
  });

  it('returns false when any area has completedAt != null (awaiting reset)', () => {
    expect(shouldClearStocktakeActive([[{ startedAt: null, completedAt: 'ts' }]])).toBe(false);
  });

  it('returns false when a later dept has an open area', () => {
    const areasByDept = [
      [{ startedAt: null, completedAt: null }],
      [{ startedAt: null, completedAt: null }],
      [{ startedAt: null, completedAt: 'ts' }],
    ];
    expect(shouldClearStocktakeActive(areasByDept)).toBe(false);
  });
});

// ── Suite 2: queue drain batch structure ─────────────────────────────────────
// Structural test: each queued invoice doc must produce exactly one
// batch.update({ incomingQty }) and one batch.delete on the batch.

describe('resetDepartment — queue drain batch structure', () => {
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockCommit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockCommit = jest.fn().mockResolvedValue(undefined);

    const { writeBatch } = firestore as any;
    writeBatch.mockReturnValue({ update: mockUpdate, delete: mockDelete, commit: mockCommit });

    const { updateDoc } = firestore as any;
    updateDoc.mockResolvedValue(undefined);
  });

  it('issues exactly one update + one delete per queued doc', async () => {
    const { getDocs } = firestore as any;

    const fakeQueuedDocs = [
      {
        ref: { _path: 'venues/v1/queuedInvoices/q1' },
        data: () => ({ departmentId: 'dept-1', areaId: 'area-1', itemId: 'item-1', qty: 3 }),
      },
      {
        ref: { _path: 'venues/v1/queuedInvoices/q2' },
        data: () => ({ departmentId: 'dept-1', areaId: 'area-1', itemId: 'item-2', qty: 5 }),
      },
    ];

    const emptySnap = { docs: [], empty: true, size: 0, forEach: (_fn: any) => {} };
    const queueSnap = {
      docs: fakeQueuedDocs,
      empty: false,
      size: 2,
      forEach: (fn: any) => fakeQueuedDocs.forEach(fn),
    };

    getDocs.mockImplementation(async (ref: any) => {
      const path = ref?._path || '';
      if (path.includes('queuedInvoices')) return queueSnap;
      return emptySnap;
    });

    await resetDepartment('v1', 'dept-1');

    // Area reset and stocktakeActive check may also call update; filter to drain updates
    const incomingUpdates = mockUpdate.mock.calls.filter(
      ([_ref, data]: any[]) => data?.incomingQty !== undefined,
    );
    const queueDeletes = mockDelete.mock.calls.filter(
      ([ref]: any[]) => typeof ref?._path === 'string' && ref._path.includes('queuedInvoices'),
    );

    expect(incomingUpdates).toHaveLength(2);
    expect(queueDeletes).toHaveLength(2);
  });

  it('drain filters by departmentId — skips queued docs for other departments', async () => {
    // The Firestore where() query is what filters; here we verify resetDepartment
    // passes the correct departmentId to the where clause.
    const { getDocs, where } = firestore as any;
    getDocs.mockResolvedValue({ docs: [], empty: true, size: 0, forEach: (_fn: any) => {} });

    await resetDepartment('v1', 'dept-A');

    const whereCalls: any[] = where.mock.calls;
    const deptFilter = whereCalls.find(
      ([field, op, val]: any[]) => field === 'departmentId' && op === '==' && val === 'dept-A',
    );
    expect(deptFilter).toBeDefined();
  });
});

// ── Suite 3: productPrices block is gone ─────────────────────────────────────
// Structural proof that the old per-item getDoc fetch was deleted from both
// functions. After P3b, product prices are fetched wholesale once via
// getDocs (inside refreshPricesForDepartment) using the resolveProduct
// merge-chain walk — getDoc is never called.

describe('reset.ts — getDoc never called (productPrices block removed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    (firestore.updateDoc as jest.Mock).mockResolvedValue(undefined);
    (firestore.getDocs as jest.Mock).mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
      forEach: () => {},
    });
  });

  it('resetDepartment does not call getDoc', async () => {
    await resetDepartment('v1', 'dept-1');
    expect((firestore as any).getDoc).not.toHaveBeenCalled();
  });

  it('resetAllDepartmentsStockTake does not call getDoc', async () => {
    await resetAllDepartmentsStockTake('v1');
    expect((firestore as any).getDoc).not.toHaveBeenCalled();
  });
});

// ── Shared helpers for the P3b integration tests ──────────────────────────────

function makeSnap(docs: any[]) {
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: any) => docs.forEach(fn) };
}
function makeAreaDoc(id: string) {
  return { id, data: () => ({ startedAt: null, completedAt: null }) };
}
function makeItemDoc(id: string, areaId: string, deptId: string, data: Record<string, any>) {
  return {
    id,
    ref: { _path: `venues/v1/departments/${deptId}/areas/${areaId}/items/${id}` },
    data: () => data,
  };
}
function makeProductDoc(id: string, data: Record<string, any>) {
  return { id, data: () => data };
}

// ── Suite 4: merge-chain resolution — resetDepartment ────────────────────────

describe('resetDepartment — merged product resolves to survivor price (P3b bug fix)', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    (firestore.updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  it('resolves a merged product via the chain-walk and applies the survivor costPrice to the item', async () => {
    const areaSnap = makeSnap([makeAreaDoc('area-1')]);
    const itemSnap = makeSnap([
      makeItemDoc('item-1', 'area-1', 'dept-1', {
        productId: 'prod-defunct',
        costPrice: 5,
        lastCount: 4,
      }),
    ]);
    const productSnap = makeSnap([
      makeProductDoc('prod-defunct', { name: 'Old Widget', active: false, mergedInto: 'prod-survivor' }),
      makeProductDoc('prod-survivor', { name: 'Widget', costPrice: 15, active: true }),
    ]);

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/products')) return productSnap;
      if (p.endsWith('/items')) return itemSnap;
      if (p.endsWith('/areas') && p.includes('/departments/')) return areaSnap;
      return makeSnap([]); // legacy areas, queuedInvoices, departments list
    });

    await resetDepartment('v1', 'dept-1');

    // Item batch: price refresh should write the survivor's costPrice (15), not defunct's
    const itemRefresh = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/items/item-1'),
    );
    expect(itemRefresh).toBeDefined();
    expect(itemRefresh![1].costPrice).toBe(15);
    expect(itemRefresh![1].costPriceSource).toBe('cycle_reset');

    // Basis batch: should address prod-survivor (the resolved ID), not prod-defunct
    const basisWrite = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/products/prod-survivor'),
    );
    expect(basisWrite).toBeDefined();
    expect(basisWrite![1].quantityConfidence).toBe('physical_count');

    // No basis write to the defunct product
    const defunctWrite = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/products/prod-defunct'),
    );
    expect(defunctWrite).toBeUndefined();
  });
});

// ── Suite 5: merge-chain resolution — resetAllDepartmentsStockTake ───────────

describe('resetAllDepartmentsStockTake — merged product resolves to survivor price (P3b bug fix)', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    (firestore.updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  it('resolves a merged product via the chain-walk in the venue-wide reset path', async () => {
    const deptSnap = makeSnap([{ id: 'dept-1', data: () => ({}) }]);
    const areaSnap = makeSnap([makeAreaDoc('area-1')]);
    const itemSnap = makeSnap([
      makeItemDoc('item-1', 'area-1', 'dept-1', {
        productId: 'prod-defunct',
        costPrice: 5,
        lastCount: 4,
      }),
    ]);
    const productSnap = makeSnap([
      makeProductDoc('prod-defunct', { name: 'Old Widget', active: false, mergedInto: 'prod-survivor' }),
      makeProductDoc('prod-survivor', { name: 'Widget', costPrice: 15, active: true }),
    ]);

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/departments')) return deptSnap;
      if (p.endsWith('/products')) return productSnap;
      if (p.endsWith('/items')) return itemSnap;
      if (p.endsWith('/areas') && p.includes('/departments/')) return areaSnap;
      return makeSnap([]);
    });

    await resetAllDepartmentsStockTake('v1');

    const itemRefresh = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/items/item-1'),
    );
    expect(itemRefresh).toBeDefined();
    expect(itemRefresh![1].costPrice).toBe(15);

    const basisWrite = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/products/prod-survivor'),
    );
    expect(basisWrite).toBeDefined();
    expect(basisWrite![1].quantityConfidence).toBe('physical_count');
  });
});

// ── Suite 6: ordering — basis reads post-restoration lastCount ────────────────

describe('resetDepartment — ordering: physical-count basis reads post-restoration lastCount', () => {
  let batchUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    batchUpdate = jest.fn();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: batchUpdate,
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    (firestore.updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  it('sums the restored lastCount (= confirmedCount) not the stale pre-reset value', async () => {
    const areaSnap = makeSnap([makeAreaDoc('area-1')]);
    // First item fetch (restoration loop): stale lastCount, but confirmedCount reveals the truth.
    const staleItemSnap = makeSnap([
      makeItemDoc('item-1', 'area-1', 'dept-1', {
        productId: 'prod-1',
        costPrice: 10,
        confirmedCount: 5, // will be restored to lastCount
        lastCount: 2,      // stale — must NOT be used for basis
      }),
    ]);
    // Second item fetch (refreshPricesForDepartment): post-restoration state.
    const freshItemSnap = makeSnap([
      makeItemDoc('item-1', 'area-1', 'dept-1', {
        productId: 'prod-1',
        costPrice: 10,
        lastCount: 5, // confirmedCount has been applied
      }),
    ]);
    const productSnap = makeSnap([
      makeProductDoc('prod-1', { name: 'Widget', costPrice: 10, active: true }),
    ]);

    // Distinguish the two item fetches by call order.
    let itemFetchCount = 0;
    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/products')) return productSnap;
      if (p.endsWith('/items')) {
        itemFetchCount++;
        return itemFetchCount === 1 ? staleItemSnap : freshItemSnap;
      }
      if (p.endsWith('/areas') && p.includes('/departments/')) return areaSnap;
      return makeSnap([]);
    });

    await resetDepartment('v1', 'dept-1');

    // The basis write must use lastCount: 5 (from freshItemSnap), not 2 (from staleItemSnap).
    const basisWrite = batchUpdate.mock.calls.find(
      ([ref]: any[]) => ref._path.includes('/products/prod-1'),
    );
    expect(basisWrite).toBeDefined();
    expect(basisWrite![1].costPriceQuantityBasis).toBe(5);
  });
});

// ── Suite 7: aggregation across departments — resetAllDepartmentsStockTake ───

describe('resetAllDepartmentsStockTake — aggregates price-refresh counts across departments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (firestore.writeBatch as jest.Mock).mockReturnValue({
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    });
    (firestore.updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  it('sums itemsPriceRefreshed and itemsAlreadyCurrent across all departments', async () => {
    // dept-1: item with stale price → 1 refresh
    // dept-2: item already current → 1 alreadyCurrent
    const deptSnap = makeSnap([
      { id: 'dept-1', data: () => ({}) },
      { id: 'dept-2', data: () => ({}) },
    ]);
    const areaSnap = makeSnap([makeAreaDoc('area-1')]);
    const productSnap = makeSnap([
      makeProductDoc('prod-A', { name: 'Product A', costPrice: 20, active: true }),
      makeProductDoc('prod-B', { name: 'Product B', costPrice: 10, active: true }),
    ]);
    const dept1ItemSnap = makeSnap([
      makeItemDoc('item-1', 'area-1', 'dept-1', {
        productId: 'prod-A', costPrice: 5, lastCount: 3, // stale price → refreshed
      }),
    ]);
    const dept2ItemSnap = makeSnap([
      makeItemDoc('item-2', 'area-1', 'dept-2', {
        productId: 'prod-B', costPrice: 10, lastCount: 7, // already current
      }),
    ]);

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p = ref?._path ?? '';
      if (p.endsWith('/departments')) return deptSnap;
      if (p.endsWith('/products')) return productSnap;
      if (p.endsWith('/areas') && p.includes('/departments/')) return areaSnap;
      if (p.includes('/dept-1/') && p.endsWith('/items')) return dept1ItemSnap;
      if (p.includes('/dept-2/') && p.endsWith('/items')) return dept2ItemSnap;
      return makeSnap([]);
    });

    const result = await resetAllDepartmentsStockTake('v1');

    expect(result.itemsPriceRefreshed).toBe(1);  // dept-1's stale item
    expect(result.itemsAlreadyCurrent).toBe(1);  // dept-2's current item
  });
});
