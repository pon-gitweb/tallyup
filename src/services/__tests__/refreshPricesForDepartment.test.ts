// Tests for refreshPricesForVenue (venue-level loop over refreshPricesForDepartment).
//
// Covered scenarios:
//   (a) aggregation — totals are correctly summed across multiple active depts
//   (b) inactive skip — departments with active===false are skipped entirely
//   (c) no side effects — setDoc and updateDoc are never called; getDocs never
//       touches queued-invoice or session paths; only the price+basis writes
//       produced by refreshPricesForDepartment reach Firestore

// ── Firebase mock ─────────────────────────────────────────────────────────────
// Must appear before any imports to prevent module-level Firestore init.
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  doc: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: jest.fn(() => '__ts__'),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}));

import { refreshPricesForVenue } from '../refreshPricesForDepartment';
import * as firestore from 'firebase/firestore';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VENUE = 'v1';

function makeSnap(docs: any[]) {
  return {
    docs,
    empty: docs.length === 0,
    forEach: (fn: (d: any) => void) => docs.forEach(fn),
  };
}

function makeDeptDoc(id: string, data: Record<string, any> = {}) {
  return { id, data: () => data };
}

function makeAreaDoc(id: string) {
  return { id, data: () => ({}) };
}

function makeItemDoc(
  id: string,
  areaId: string,
  deptId: string,
  data: Record<string, any>,
) {
  return {
    id,
    ref: { _path: `venues/${VENUE}/departments/${deptId}/areas/${areaId}/items/${id}` },
    data: () => data,
  };
}

function makeProductDoc(id: string, data: Record<string, any>) {
  return { id, data: () => data };
}

// ── Suite (a): cross-department aggregation ───────────────────────────────────

describe('refreshPricesForVenue — aggregation across departments', () => {
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

  it('sums itemsPriceRefreshed and itemsAlreadyCurrent across two active departments', async () => {
    // dept-1: one item with a stale price  → 1 refreshed
    // dept-2: one item with a current price → 1 alreadyCurrent
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 20, active: true });

    const staleItem   = makeItemDoc('item-stale',   'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5,  lastCount: 3 });
    const currentItem = makeItemDoc('item-current', 'area-2', 'dept-2', { productId: 'prod-A', costPrice: 20, lastCount: 7 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)            return makeSnap([makeDeptDoc('dept-1'), makeDeptDoc('dept-2')]);
      if (p.endsWith('/products'))                       return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p === `venues/${VENUE}/departments/dept-2/areas`) return makeSnap([makeAreaDoc('area-2')]);
      if (p.includes('/dept-1/') && p.endsWith('/items')) return makeSnap([staleItem]);
      if (p.includes('/dept-2/') && p.endsWith('/items')) return makeSnap([currentItem]);
      return makeSnap([]);
    });

    const result = await refreshPricesForVenue(VENUE);

    expect(result.itemsPriceRefreshed).toBe(1);
    expect(result.itemsAlreadyCurrent).toBe(1);
  });

  it('aggregates itemsPriceRefreshed correctly when both departments have stale items', async () => {
    const productA = makeProductDoc('prod-A', { name: 'Beer',  costPrice: 20, active: true });
    const productB = makeProductDoc('prod-B', { name: 'Wine',  costPrice: 15, active: true });

    const item1 = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 2 });
    const item2 = makeItemDoc('item-2', 'area-2', 'dept-2', { productId: 'prod-B', costPrice: 8, lastCount: 4 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)               return makeSnap([makeDeptDoc('dept-1'), makeDeptDoc('dept-2')]);
      if (p.endsWith('/products'))                          return makeSnap([productA, productB]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p === `venues/${VENUE}/departments/dept-2/areas`) return makeSnap([makeAreaDoc('area-2')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item1]);
      if (p.includes('/dept-2/') && p.endsWith('/items'))   return makeSnap([item2]);
      return makeSnap([]);
    });

    const result = await refreshPricesForVenue(VENUE);

    expect(result.itemsPriceRefreshed).toBe(2);
    expect(result.itemsAlreadyCurrent).toBe(0);
  });
});

// ── Suite (b): inactive-department skip ───────────────────────────────────────

describe('refreshPricesForVenue — inactive department skip', () => {
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

  it('skips a department with active===false and does not count its items', async () => {
    // dept-1 active, dept-2 inactive.
    // dept-2 has a stale item — if it were processed, itemsPriceRefreshed would be 2.
    // Correct behaviour: only dept-1 is processed → 1 refreshed.
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 20, active: true });
    const item1   = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 3 });
    const item2   = makeItemDoc('item-2', 'area-2', 'dept-2', { productId: 'prod-A', costPrice: 5, lastCount: 6 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)
        return makeSnap([makeDeptDoc('dept-1', { active: true }), makeDeptDoc('dept-2', { active: false })]);
      if (p.endsWith('/products'))                          return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item1]);
      // dept-2 paths should never be reached
      return makeSnap([]);
    });

    const result = await refreshPricesForVenue(VENUE);

    expect(result.itemsPriceRefreshed).toBe(1);
    expect(result.itemsAlreadyCurrent).toBe(0);

    // Verify no getDocs call reached dept-2 areas or items
    const getDocsCalls: string[] = (firestore.getDocs as jest.Mock).mock.calls.map(
      ([ref]: any[]) => ref?._path ?? '',
    );
    expect(getDocsCalls.some(p => p.includes('/dept-2/'))).toBe(false);
  });

  it('treats a department with no active field as active (absent === active)', async () => {
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 10, active: true });
    const item    = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 1 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)
        return makeSnap([makeDeptDoc('dept-1', { /* no active field */ name: 'Bar' })]);
      if (p.endsWith('/products'))                          return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item]);
      return makeSnap([]);
    });

    const result = await refreshPricesForVenue(VENUE);

    // dept-1 was processed (no active field → treated as active)
    expect(result.itemsPriceRefreshed).toBe(1);
  });
});

// ── Suite (c): no side effects ────────────────────────────────────────────────

describe('refreshPricesForVenue — no area/session/queue side effects', () => {
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

  it('never calls setDoc (area flags) or updateDoc (stocktakeActive)', async () => {
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 10, active: true });
    const item    = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 2 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)               return makeSnap([makeDeptDoc('dept-1')]);
      if (p.endsWith('/products'))                          return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item]);
      return makeSnap([]);
    });

    await refreshPricesForVenue(VENUE);

    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
  });

  it('never reads queuedInvoices or sessions collections', async () => {
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 10, active: true });
    const item    = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 1 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)               return makeSnap([makeDeptDoc('dept-1')]);
      if (p.endsWith('/products'))                          return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item]);
      return makeSnap([]);
    });

    await refreshPricesForVenue(VENUE);

    const getDocsPaths: string[] = (firestore.getDocs as jest.Mock).mock.calls.map(
      ([ref]: any[]) => ref?._path ?? '',
    );
    expect(getDocsPaths.some(p => p.includes('queuedInvoices'))).toBe(false);
    expect(getDocsPaths.some(p => p.includes('sessions'))).toBe(false);
  });

  it('only writes item.costPrice and product.costPriceQuantityBasis — no area writes', async () => {
    const product = makeProductDoc('prod-A', { name: 'Beer', costPrice: 20, active: true });
    const item    = makeItemDoc('item-1', 'area-1', 'dept-1', { productId: 'prod-A', costPrice: 5, lastCount: 4 });

    (firestore.getDocs as jest.Mock).mockImplementation(async (ref: any) => {
      const p: string = ref?._path ?? '';
      if (p === `venues/${VENUE}/departments`)               return makeSnap([makeDeptDoc('dept-1')]);
      if (p.endsWith('/products'))                          return makeSnap([product]);
      if (p === `venues/${VENUE}/departments/dept-1/areas`) return makeSnap([makeAreaDoc('area-1')]);
      if (p.includes('/dept-1/') && p.endsWith('/items'))   return makeSnap([item]);
      return makeSnap([]);
    });

    await refreshPricesForVenue(VENUE);

    // Every batchUpdate call must target an /items/ or /products/ path.
    // An /areas/<id> write (without a trailing /items/ segment) would indicate
    // an area-state side effect, which must never happen here.
    for (const [ref] of batchUpdate.mock.calls) {
      const path: string = ref?._path ?? '';
      const isItemPath    = path.includes('/items/');
      const isProductPath = path.includes('/products/') && !path.includes('/items/');
      expect(isItemPath || isProductPath).toBe(true);
    }
  });
});
