import { uploadUriViaApi } from '../imports/uploadViaApi';

export type UploadResult = { fullPath: string; downloadURL?: string | null };

function isUploadResult(x: unknown): x is UploadResult {
  if (!x || typeof x !== 'object') return false;
  const o = x as any;
  if (typeof o.fullPath !== 'string' || !o.fullPath.trim()) return false;
  if (o.downloadURL != null && typeof o.downloadURL !== 'string') return false;
  return true;
}

/**
 * Uploads a JPEG photo as stock-take evidence.
 * Storage path:
 *   uploads/{venueId}/stocktake/photos/{areaId}/{itemId}/{ts}-{safeName}
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

  // Keep current behaviour: require local file URI.
  // (Expo camera gives file://; if we later support content:// we can expand here.)
  if (!fileUri || !String(fileUri).startsWith('file')) {
    throw new Error('uploadStockTakePhoto: expected local file URI');
  }

  const safeName = (params.fileName || `photo_${Date.now()}.jpg`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);

  const destPath = `uploads/${venueId}/stocktake/photos/${areaId}/${itemId}/${Date.now()}-${safeName}`;

  const outUnknown = await uploadUriViaApi({
    fileUri,
    destPath,
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
  });

  if (!isUploadResult(outUnknown)) {
    const keys =
      outUnknown && typeof outUnknown === 'object' ? Object.keys(outUnknown as any).join(',') : typeof outUnknown;
    throw new Error(`uploadStockTakePhoto: uploadUriViaApi returned unexpected shape (${keys})`);
  }

  if (__DEV__ && !process.env.JEST_WORKER_ID) console.log('[StockTakePhoto] uploaded', { destPath, fullPath: outUnknown.fullPath });
  return outUnknown;
}
