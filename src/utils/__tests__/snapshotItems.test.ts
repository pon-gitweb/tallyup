import { loadSnapshotItems } from '../snapshotItems';

describe('loadSnapshotItems', () => {
  it('legacy: returns snapshotData.items when itemChunkCount is absent', async () => {
    const items = [{ name: 'Beer', actualClosing: 5 }, { name: 'Wine', actualClosing: 3 }];
    const result = await loadSnapshotItems({ items }, async () => []);
    expect(result).toEqual(items);
  });

  it('legacy: returns empty array when neither field present', async () => {
    const result = await loadSnapshotItems({}, async () => []);
    expect(result).toEqual([]);
  });

  it('legacy: returns snapshotData.items when itemChunkCount is 0', async () => {
    const items = [{ name: 'Gin', actualClosing: 2 }];
    const result = await loadSnapshotItems({ items, itemChunkCount: 0 }, async () => []);
    expect(result).toEqual(items);
  });

  it('chunked: calls fetchChunks and concatenates in index order', async () => {
    const chunk0 = { index: 0, items: [{ name: 'A' }, { name: 'B' }] };
    const chunk1 = { index: 1, items: [{ name: 'C' }] };
    // Return chunks out of order to test sorting
    const result = await loadSnapshotItems(
      { itemChunkCount: 2, items: [] },
      async () => [chunk1, chunk0],
    );
    expect(result).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  });

  it('chunked: 570 items across 3 chunks returns all 570', async () => {
    const buildItems = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `item-${i}` }));
    const chunks = [
      { index: 0, items: buildItems(200) },
      { index: 1, items: buildItems(200) },
      { index: 2, items: buildItems(170) },
    ];
    const result = await loadSnapshotItems(
      { itemChunkCount: 3, items: buildItems(200) },
      async () => chunks,
    );
    expect(result).toHaveLength(570);
    expect(result[0].name).toBe('item-0');
    expect(result[400].name).toBe('item-0'); // chunk 2 starts fresh
  });
});
