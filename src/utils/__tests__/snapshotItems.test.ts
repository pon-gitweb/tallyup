import { loadSnapshotItems } from '../snapshotItems';

// All tests pass itemsGranularity: 'product' so toProductItems is a no-op;
// the grouping / aggregation behaviour is tested in productSnapshotItems.test.ts.
describe('loadSnapshotItems', () => {
  it('legacy: returns snapshotData.items when itemChunkCount is absent', async () => {
    const items = [{ name: 'Beer', actualClosing: 5 }, { name: 'Wine', actualClosing: 3 }];
    const result = await loadSnapshotItems({ items, itemsGranularity: 'product' }, async () => []);
    expect(result).toEqual(items);
  });

  it('legacy: returns empty array when neither field present', async () => {
    const result = await loadSnapshotItems({ itemsGranularity: 'product' }, async () => []);
    expect(result).toEqual([]);
  });

  it('legacy: returns snapshotData.items when itemChunkCount is 0', async () => {
    const items = [{ name: 'Gin', actualClosing: 2 }];
    const result = await loadSnapshotItems({ items, itemChunkCount: 0, itemsGranularity: 'product' }, async () => []);
    expect(result).toEqual(items);
  });

  it('chunked: calls fetchChunks and concatenates in index order', async () => {
    const chunk0 = { index: 0, items: [{ name: 'A' }, { name: 'B' }] };
    const chunk1 = { index: 1, items: [{ name: 'C' }] };
    // Return chunks out of order to test sorting
    const result = await loadSnapshotItems(
      { itemChunkCount: 2, items: [], itemsGranularity: 'product' },
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
      { itemChunkCount: 3, items: buildItems(200), itemsGranularity: 'product' },
      async () => chunks,
    );
    expect(result).toHaveLength(570);
    expect(result[0].name).toBe('item-0');
    expect(result[400].name).toBe('item-0'); // chunk 2 starts fresh
  });

  it('legacy snapshot (no itemsGranularity): toProductItems groups per-area rows by name', async () => {
    // Two area rows for the same product — should be aggregated to one product item
    const items = [
      { name: 'Champagne', areaId: 'a1', areaName: 'Bar', actualClosing: 3 },
      { name: 'Champagne', areaId: 'a2', areaName: 'Cellar', actualClosing: 5 },
      { name: 'Wine', areaId: 'a1', areaName: 'Bar', actualClosing: 2 },
    ];
    const result = await loadSnapshotItems({ items }, async () => []);
    expect(result).toHaveLength(2);
    const cham = result.find((i: any) => i.name === 'Champagne');
    expect(cham.actualClosing).toBe(8); // 3 + 5
    expect(cham.varianceReliable).toBe(false);
    const wine = result.find((i: any) => i.name === 'Wine');
    expect(wine.actualClosing).toBe(2);
    expect(wine.varianceReliable).toBe(true);
  });
});
