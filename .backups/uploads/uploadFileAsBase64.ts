/**
 * Expo-safe upload helper for CSV/PDF/etc.
 * Reads any picked file (CSV, PDF, image, etc.) as base64 using expo-file-system
 * and uploads it to Firebase Storage using uploadString('data_url').
 * No Blob, no ArrayBuffer.
 */
import * as FileSystem from 'expo-file-system';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';

export async function uploadFileAsBase64(opts: {
  venueId: string;
  orderId: string;
  uri: string;
  mime?: string; // 'text/csv' | 'application/pdf' | etc.
  fileName?: string;
}) {
  const { venueId, orderId, uri, mime = 'application/octet-stream', fileName } = opts;
  if (!venueId || !orderId) throw new Error('Missing venueId or orderId');
  if (!uri) throw new Error('Missing file URI');

  console.log('[uploadFileAsBase64] reading file', uri);

  // Read as base64
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const dataUrl = `data:${mime};base64,${base64}`;

  const storage = getStorage();
  const safeName = (fileName || `${Date.now()}.${mime.includes('pdf') ? 'pdf' : 'csv'}`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120);
  const fullPath = `venues/${venueId}/invoices/raw/${orderId}/${safeName}`;
  const refPath = ref(storage, fullPath);

  console.log('[uploadFileAsBase64] uploading to', fullPath);

  await uploadString(refPath, dataUrl, 'data_url');
  const url = await getDownloadURL(refPath);

  console.log('[uploadFileAsBase64] success', url);
  return { fullPath, url };
}
