// Mock firebase modules before any imports — prevents the module-level
// Firestore/Auth init in reset.ts from requiring a live Firebase app.
jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  query: jest.fn((colRef: any) => ({ ...colRef })), // preserve _path through query()
  where: jest.fn((field: string, op: string, val: string) => ({ _field: field })),
  getDocs: jest.fn(),
  writeBatch: jest.fn(),
  doc: jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  serverTimestamp: jest.fn(() => 'SERVER_TS'),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  increment: jest.fn((n: number) => ({ _increment: n })),
  deleteDoc: jest.fn(),
}));

import { shouldClearStocktakeActive, resetDepartment } from '../reset';
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
