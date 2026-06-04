// @ts-nocheck
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { CSV_UPLOAD_URL } from './urls';

type UploadResult = {
  cancelled: boolean;
  filename?: string;
  rowsCount?: number;     // optional (parser not run client-side here)
  headersCount?: number;  // optional
  storagePath?: string;
};

/**
 * FIX 7: Accept an optional onProgress callback so callers can show loading state.
 * On iOS, iCloud Drive files must download before copyToCacheDirectory completes —
 * this can take several seconds and the app appears frozen without a loading indicator.
 * Callers should pass onProgress and display the messages returned to the user.
 *
 * Usage:
 *   setLoadingMessage('Preparing file…');
 *   await pickParseAndUploadProductsCsv(venueId, msg => setLoadingMessage(msg));
 *   setLoadingMessage(null);
 */
export async function pickParseAndUploadProductsCsv(
  venueId: string,
  onProgress?: (message: string) => void,
): Promise<UploadResult> {
  // 1) Pick a file (only .csv)
  onProgress?.('Preparing file…');
  const pick = await DocumentPicker.getDocumentAsync({
    multiple: false,
    type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'application/vnd.ms-excel', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });

  // New API returns {assets} in SDK 53; older returns {canceled}
  // Normalize:
  const canceled = (pick as any).canceled ?? (pick as any).type === 'cancel';
  if (canceled) return { cancelled: true };

  const asset = (pick as any).assets ? (pick as any).assets[0] : pick;
  const filename = String(asset?.name || 'upload.csv');
  const uri: string = String(asset?.uri || '');

  // 2) Read as UTF-8 text (works for file:// and content:// URIs with the picker permission)
  onProgress?.('Reading file…');
  const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });

  // 3) POST JSON to Cloud Function (no Blob!)
  onProgress?.('Uploading…');
  if (!CSV_UPLOAD_URL) throw new Error('Missing EXPO_PUBLIC_UPLOAD_CSV_URL');
  const r = await fetch(CSV_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      venueId,
      filename,
      content,
      contentType: 'text/csv',
    }),
  });

  const j = await r.json().catch(()=>null);
  if (!r.ok || !j || j.ok === false) {
    const msg = (j && j.error) ? j.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }

  // Server returns { ok:true, path }
  return {
    cancelled: false,
    filename,
    storagePath: j.path,
  };
}
