import { createStockTakePhotoDoc } from '../stockTakePhotos';

jest.mock('../../firebase', () => ({
  db: {} as any,
}));

jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore');
  return {
    ...actual,
    collection: jest.fn(() => ({ __col: true })),
    addDoc: jest.fn(async () => ({ id: 'doc_1' })),
    serverTimestamp: jest.fn(() => ({ __serverTs: true })),
  };
});

import { addDoc } from 'firebase/firestore';

describe('createStockTakePhotoDoc', () => {
  beforeEach(() => {
    (addDoc as jest.Mock).mockClear();
  });

  it('rejects non-finite count', async () => {
    // NaN should reject
    await expect(
      createStockTakePhotoDoc({
        venueId: 'v1',
        departmentId: null,
        areaId: 'a1',
        areaNameSnapshot: 'Bar',
        areaStartedAtMs: null,
        itemId: 'i1',
        itemNameSnapshot: 'Vodka',
        unitSnapshot: 'bottle',
        count: Number.NaN,
        note: null,
        storagePath: 'uploads/v1/x.jpg',
        createdBy: 'u1',
      })
    ).rejects.toThrow('count must be finite');
  });

  it('writes doc and returns id', async () => {
    const res = await createStockTakePhotoDoc({
      venueId: 'v1',
      departmentId: 'd1',
      areaId: 'a1',
      areaNameSnapshot: 'Bar',
      areaStartedAtMs: 123,
      itemId: 'i1',
      itemNameSnapshot: 'Vodka',
      unitSnapshot: 'bottle',
      count: 12,
      note: 'damaged',
      storagePath: 'uploads/v1/x.jpg',
      createdBy: 'u1',
    });

    expect(res.id).toBe('doc_1');
    expect(addDoc).toHaveBeenCalledTimes(1);
  });
});
