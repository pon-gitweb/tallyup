import { getApp } from 'firebase/app';
import { getStorage, ref, uploadString, getDownloadURL, UploadMetadata } from 'firebase/storage';

type Opts = {
  destPath: string;         // e.g. "uploads/invoices/abc.csv"
  dataUrl: string;          // data URL or base64; use "data_url" format
  contentType?: string;     // e.g. "text/csv"
  cacheControl?: string;    // optional cache control
};

/**
 * Upload a base64/data-URL string to Firebase Storage (Expo-safe).
 * Returns { fullPath, downloadURL }.
 */
export async function uploadFileAsBase64(opts: Opts): Promise<{ fullPath: string; downloadURL: string }> {
  const { destPath, dataUrl, contentType, cacheControl } = opts;
  if (!destPath || !dataUrl) throw new Error('uploadFileAsBase64: missing destPath/dataUrl');

  const storage = getStorage(getApp());
  const r = ref(storage, destPath);

  const metadata: UploadMetadata = {};
  if (contentType) metadata.contentType = contentType;
  if (cacheControl) metadata.cacheControl = cacheControl;

  await uploadString(r, dataUrl, 'data_url', metadata);
  const downloadURL = await getDownloadURL(r);
  return { fullPath: r.fullPath, downloadURL };
}
