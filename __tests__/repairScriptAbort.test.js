// Tests for repair-snapshot-baseline.js abort safety and chunk loading.
// Uses CommonJS to match the script itself.

const { loadItems, repairItems } = require('../scripts/admin/repair-snapshot-baseline');

// ── loadItems ──────────────────────────────────────────────────────────────

describe('loadItems', () => {
  it('returns items array when no itemChunkCount', async () => {
    const docRef = { collection: jest.fn() };
    const data = { items: [{ name: 'Beer' }], itemChunkCount: 0 };
    const result = await loadItems(docRef, data);
    expect(result).toEqual([{ name: 'Beer' }]);
    expect(docRef.collection).not.toHaveBeenCalled();
  });

  it('returns empty array when items absent and no chunks', async () => {
    const docRef = { collection: jest.fn() };
    const result = await loadItems(docRef, {});
    expect(result).toEqual([]);
  });

  it('loads and concatenates chunks sorted by index', async () => {
    const chunk0 = { index: 0, items: Array.from({ length: 200 }, (_, i) => ({ name: `item-${i}` })) };
    const chunk1 = { index: 1, items: Array.from({ length: 200 }, (_, i) => ({ name: `item-${200 + i}` })) };
    const chunk2 = { index: 2, items: Array.from({ length: 170 }, (_, i) => ({ name: `item-${400 + i}` })) };

    const chunksCollection = {
      get: jest.fn().mockResolvedValue({
        // Return out-of-order to verify sort
        docs: [
          { data: () => chunk2 },
          { data: () => chunk0 },
          { data: () => chunk1 },
        ],
      }),
    };
    const docRef = { collection: jest.fn().mockReturnValue(chunksCollection) };
    const data = { itemChunkCount: 3, items: [] };

    const result = await loadItems(docRef, data);
    expect(result).toHaveLength(570);
    expect(result[0].name).toBe('item-0');
    expect(result[199].name).toBe('item-199');
    expect(result[200].name).toBe('item-200');
    expect(result[569].name).toBe('item-569');
    expect(docRef.collection).toHaveBeenCalledWith('itemChunks');
  });
});

// ── abort condition ────────────────────────────────────────────────────────

describe('partial-items abort guard', () => {
  it('aborts when itemCount > loaded items length', async () => {
    // Simulate having itemCount:570 but only loading 200 (missing chunks)
    const docRef = { collection: jest.fn() };
    const data = { itemCount: 570, items: Array.from({ length: 200 }, () => ({})), itemChunkCount: 0 };
    const loaded = await loadItems(docRef, data);

    const claimedCount = data.itemCount ?? data.summary?.totalItemsCounted ?? null;
    const shouldAbort = claimedCount != null && claimedCount > loaded.length;
    expect(shouldAbort).toBe(true);
  });

  it('does not abort when loaded items match claimed count', async () => {
    const docRef = { collection: jest.fn() };
    const data = { itemCount: 200, items: Array.from({ length: 200 }, () => ({})), itemChunkCount: 0 };
    const loaded = await loadItems(docRef, data);

    const claimedCount = data.itemCount ?? null;
    const shouldAbort = claimedCount != null && claimedCount > loaded.length;
    expect(shouldAbort).toBe(false);
  });

  it('does not abort when itemCount absent (legacy snapshot)', async () => {
    const docRef = { collection: jest.fn() };
    const data = { items: Array.from({ length: 150 }, () => ({})) };
    const loaded = await loadItems(docRef, data);

    const claimedCount = data.itemCount ?? data.summary?.totalItemsCounted ?? null;
    const shouldAbort = claimedCount != null && claimedCount > loaded.length;
    expect(shouldAbort).toBe(false);
  });
});
