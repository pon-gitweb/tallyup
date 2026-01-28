// @ts-nocheck
import { uploadUriViaApi } from '../imports/uploadViaApi';

type UploadResult = { fullPath: string; downloadURL?: string | null };

/**
 * Uploads a JPEG photo as stock-take evidence.
 * Storage path:
 *   uploads/{venueId}/stocktake/photos/{areaId}/{itemId}/{ts}.jpg
 */
export async function uploadStockTakePhoto(params: {
  venueId: string;
  areaId: string;
  itemId: string;
  fileUri: string;
  fileName?: string;
}): Promise<UploadResult> {
  const { venueId, areaId, itemId, fileUri } = params;
  if (!venueId) throw new Error('uploadStockTakePhoto: missing venueId');
  if (!areaId) throw new Error('uploadStockTakePhoto: missing areaId');
  if (!itemId) throw new Error('uploadStockTakePhoto: missing itemId');
  if (!fileUri || !String(fileUri).startsWith('file')) throw new Error('uploadStockTakePhoto: expected local file URI');

  const safeName = (params.fileName || `photo_${Date.now()}.jpg`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);

  const destPath = `uploads/${venueId}/stocktake/photos/${areaId}/${itemId}/${Date.now()}-${safeName}`;

  const out = await uploadUriViaApi({
    fileUri,
    destPath,
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
  });

  if (__DEV__) console.log('[StockTakePhoto] uploaded', { destPath, fullPath: out?.fullPath });
  return out;
}
