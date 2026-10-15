/**
 * Tests for multi-area correction logic in stocktakeCorrection.ts (Item 3).
 *
 * Covers:
 * - Block path: product counted in >1 area, no areaId → error thrown, no write
 * - Per-area path: areaId provided → area patched, product actualClosing = sum of areas
 * - Single-area path: existing behaviour unchanged
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Firestore mocks ──────────────────────────────────────────────────────────

const mockCommit      = vi.fn().mockResolvedValue(undefined);
const mockBatchUpdate = vi.fn();
const mockBatchSet    = vi.fn();
const mockWriteBatch  = vi.fn(() => ({ update: mockBatchUpdate, set: mockBatchSet, commit: mockCommit }));
const mockGetDoc      = vi.fn();
const mockGetDocs     = vi.fn();
const mockDoc         = vi.fn((...args: any[]) => ({ _ref: args.join('/') }));
const mockCollection  = vi.fn((...args: any[]) => ({ _col: args.join('/') }));
const mockServerTs    = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/firestore', () => ({
  doc:              (...args: any[]) => mockDoc(...args),
  collection:       (...args: any[]) => mockCollection(...args),
  getDoc:           (...args: any[]) => mockGetDoc(...args),
  getDocs:          (...args: any[]) => mockGetDocs(...args),
  writeBatch:       (...args: any[]) => mockWriteBatch(...args),
  serverTimestamp:  () => mockServerTs(),
  query:            vi.fn(c => c),
  where:            vi.fn(),
  orderBy:          vi.fn(),
  limit:            vi.fn(),
}));

vi.mock('../../firebase', () => ({ db: {} }));

// Must import AFTER mocks are in place
import { commitCorrection, previewCorrection, recalculateItem } from '../stocktakeCorrection';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshotDoc(items: any[]) {
  return {
    exists: () => true,
    data: () => ({ items, itemChunkCount: 0, summary: {}, itemsGranularity: 'product' }),
  };
}

// vi.clearAllMocks() does not drain the mockResolvedValueOnce queue in Vitest 4;
// call resetMocks() at the start of each beforeEach to clear queued return values.
function resetMocks() {
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockCommit.mockReset().mockResolvedValue(undefined);
  mockBatchUpdate.mockReset();
  mockBatchSet.mockReset();
  mockWriteBatch.mockReset().mockReturnValue({ update: mockBatchUpdate, set: mockBatchSet, commit: mockCommit });
}

const BASE_ARGS = {
  venueId: 'v1',
  departmentId: 'd1',
  departmentName: 'Bar',
  cycleNumber: 2,
  reason: 'Count error',
  userId: 'u1',
  userEmail: 'user@test.com',
};

// ── recalculateItem (pure, no Firestore) ─────────────────────────────────────

describe('recalculateItem — pure formula', () => {
  it('computes variance correctly', () => {
    const item = { actualClosing: 10, openingCount: 8, costPrice: 5, parLevel: 12 };
    const r = recalculateItem(item);
    expect(r.totalVarianceQty).toBe(2);
    expect(r.totalVarianceDollars).toBe(10);
    expect(r.belowPAR).toBe(true); // 10 < 12
  });

  it('overrides actualClosing correctly', () => {
    const item = { actualClosing: 10, openingCount: 8, costPrice: 5, parLevel: 6 };
    const r = recalculateItem(item, { actualClosing: 6 });
    expect(r.totalVarianceQty).toBe(-2);
    expect(r.belowPAR).toBe(false); // 6 >= 6
  });
});

// ── previewCorrection — block path ───────────────────────────────────────────

describe('previewCorrection — multi-area block path', () => {
  beforeEach(() => {
    resetMocks();
    // Snapshot has item with 2 areas, no downstream snapshot
    const item = {
      name: 'Wine',
      actualClosing: 10,
      openingCount: 8,
      costPrice: 20,
      areas: [
        { areaId: 'a1', areaName: 'Bar', actualClosing: 4 },
        { areaId: 'a2', areaName: 'Cellar', actualClosing: 6 },
      ],
    };
    mockGetDoc
      .mockResolvedValueOnce(makeSnapshotDoc([item]))  // cycle-2 snapshot
      .mockResolvedValueOnce({ exists: () => false }); // cycle-3 (no downstream)
    mockGetDocs.mockResolvedValue({ docs: [] });
  });

  it('throws when multi-area item and no areaId provided', async () => {
    await expect(
      previewCorrection('v1', 'd1', 'Bar', 2, 'Wine', 7)
    ).rejects.toThrow('This product was counted in several areas. Correct the count per area in the app.');
  });

  it('succeeds and uses per-area sum when areaId provided', async () => {
    // Update area a2 from 6 to 9 → new sum = 4 + 9 = 13
    const preview = await previewCorrection('v1', 'd1', 'Bar', 2, 'Wine', 9, 'a2');
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].after.totalVarianceQty).toBe(13 - 8); // effectiveNewClosing=13, opening=8
  });
});

// ── commitCorrection — block path ────────────────────────────────────────────

describe('commitCorrection — multi-area block path', () => {
  beforeEach(() => {
    resetMocks();
    const item = {
      name: 'Wine',
      actualClosing: 10,
      openingCount: 8,
      costPrice: 20,
      areas: [
        { areaId: 'a1', areaName: 'Bar', actualClosing: 4 },
        { areaId: 'a2', areaName: 'Cellar', actualClosing: 6 },
      ],
    };
    mockGetDoc
      .mockResolvedValueOnce(makeSnapshotDoc([item]))
      .mockResolvedValueOnce({ exists: () => false });
    mockGetDocs.mockResolvedValue({ docs: [] });
  });

  it('throws without writing when multi-area and no areaId', async () => {
    await expect(
      commitCorrection({ ...BASE_ARGS, rawItemName: 'Wine', newActualClosing: 7 })
    ).rejects.toThrow('This product was counted in several areas. Correct the count per area in the app.');

    expect(mockCommit).not.toHaveBeenCalled();
  });
});

// ── commitCorrection — per-area update path ───────────────────────────────────

describe('commitCorrection — per-area update path', () => {
  const twoAreaItem = {
    name: 'Wine',
    actualClosing: 10,
    openingCount: 8,
    costPrice: 20,
    areas: [
      { areaId: 'a1', areaName: 'Bar', actualClosing: 4 },
      { areaId: 'a2', areaName: 'Cellar', actualClosing: 6 },
    ],
  };

  beforeEach(() => {
    resetMocks();
    mockGetDoc
      .mockResolvedValueOnce(makeSnapshotDoc([twoAreaItem]))  // cycle-2
      .mockResolvedValueOnce({ exists: () => false });         // no cycle-3
    mockGetDocs.mockResolvedValue({ docs: [] });
  });

  it('patches the target area, recomputes product actualClosing as sum, commits once', async () => {
    // Change area a2 from 6 to 9 → sum = 4 + 9 = 13
    const auditId = await commitCorrection({
      ...BASE_ARGS,
      rawItemName: 'Wine',
      newActualClosing: 9,
      areaId: 'a2',
    });

    expect(mockCommit).toHaveBeenCalledTimes(1);

    // The snapshot update call contains the patched item
    const updateCall = mockBatchUpdate.mock.calls.find((c: any[]) =>
      c[1]?.items != null
    );
    expect(updateCall).toBeDefined();
    const updatedItem = updateCall[1].items[0];
    expect(updatedItem.actualClosing).toBe(13);       // sum: 4 + 9
    expect(updatedItem.areas[1].actualClosing).toBe(9); // a2 patched
    expect(updatedItem.areas[0].actualClosing).toBe(4); // a1 unchanged
    expect(updatedItem.totalVarianceQty).toBe(5);     // 13 − 8
  });

  it('throws when areaId not found in item areas', async () => {
    await expect(
      commitCorrection({
        ...BASE_ARGS,
        rawItemName: 'Wine',
        newActualClosing: 9,
        areaId: 'a-nonexistent',
      })
    ).rejects.toThrow('Area "a-nonexistent" not found');
  });
});

// ── No undefined in batch write payloads ─────────────────────────────────────

function hasUndefinedDeep(obj: unknown): boolean {
  if (Array.isArray(obj)) return (obj as unknown[]).some(hasUndefinedDeep);
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj as object).some(v => v === undefined || hasUndefinedDeep(v));
  }
  return false;
}

describe('commitCorrection — no undefined in batch.update payloads', () => {
  beforeEach(() => {
    resetMocks();
    // Item that previously had ambiguousName: undefined (the bug) — simulates
    // a snapshot written by the buggy writer where ...item spread propagates undefined.
    const item = {
      name: 'Beer',
      actualClosing: 5,
      openingCount: 4,
      costPrice: 3,
      varianceReliable: true,
      ambiguousName: undefined,  // would have been emitted by buggy writer
      areas: [{ areaId: 'a1', areaName: 'Bar', actualClosing: 5, areaItemId: undefined }],
    };
    mockGetDoc
      .mockResolvedValueOnce(makeSnapshotDoc([item]))
      .mockResolvedValueOnce({ exists: () => false });
    mockGetDocs.mockResolvedValue({ docs: [] });
  });

  it('batch.update payloads contain no undefined values', async () => {
    await commitCorrection({ ...BASE_ARGS, rawItemName: 'Beer', newActualClosing: 7 });

    for (const call of mockBatchUpdate.mock.calls) {
      const payload = call[1];
      if (payload?.items != null) {
        expect(hasUndefinedDeep(payload)).toBe(false);
      }
    }
  });
});

// ── commitCorrection — single-area path (existing behaviour unchanged) ────────

describe('commitCorrection — single-area path (unchanged)', () => {
  beforeEach(() => {
    resetMocks();
    const item = {
      name: 'Beer',
      actualClosing: 5,
      openingCount: 4,
      costPrice: 3,
      areas: [{ areaId: 'a1', areaName: 'Bar', actualClosing: 5 }],
    };
    mockGetDoc
      .mockResolvedValueOnce(makeSnapshotDoc([item]))
      .mockResolvedValueOnce({ exists: () => false });
    mockGetDocs.mockResolvedValue({ docs: [] });
  });

  it('commits with updated actualClosing for single-area item', async () => {
    await commitCorrection({ ...BASE_ARGS, rawItemName: 'Beer', newActualClosing: 7 });

    expect(mockCommit).toHaveBeenCalledTimes(1);
    const updateCall = mockBatchUpdate.mock.calls.find((c: any[]) => c[1]?.items != null);
    expect(updateCall[1].items[0].actualClosing).toBe(7);
    expect(updateCall[1].items[0].areas[0].actualClosing).toBe(7);
  });
});
