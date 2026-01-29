import { uploadStockTakePhoto } from '../uploadStockTakePhoto';

// mock the API uploader
jest.mock('../../imports/uploadViaApi', () => ({
  uploadUriViaApi: jest.fn(),
}));

import { uploadUriViaApi } from '../../imports/uploadViaApi';

describe('uploadStockTakePhoto', () => {
  beforeEach(() => {
    (uploadUriViaApi as jest.Mock).mockReset();
  });

  it('rejects non-file URIs', async () => {
    await expect(
      uploadStockTakePhoto({
        venueId: 'v1',
        areaId: 'a1',
        itemId: 'i1',
        fileUri: 'https://example.com/x.jpg',
      })
    ).rejects.toThrow('expected local file URI');
  });

  it('throws if uploadUriViaApi returns unexpected shape', async () => {
    (uploadUriViaApi as jest.Mock).mockResolvedValue({ nope: true });

    await expect(
      uploadStockTakePhoto({
        venueId: 'v1',
        areaId: 'a1',
        itemId: 'i1',
        fileUri: 'file:///tmp/x.jpg',
      })
    ).rejects.toThrow('unexpected shape');
  });

  it('returns UploadResult when fullPath exists', async () => {
    (uploadUriViaApi as jest.Mock).mockResolvedValue({
      fullPath: 'uploads/v1/stocktake/photos/a1/i1/123-x.jpg',
      downloadURL: null,
    });

    const res = await uploadStockTakePhoto({
      venueId: 'v1',
      areaId: 'a1',
      itemId: 'i1',
      fileUri: 'file:///tmp/x.jpg',
      fileName: 'x.jpg',
    });

    expect(res.fullPath).toContain('uploads/v1/stocktake/photos/a1/i1/');
  });
});
