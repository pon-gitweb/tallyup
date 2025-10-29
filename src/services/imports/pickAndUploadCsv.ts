// @ts-nocheck
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { uploadText } from 'src/services/firebase/storage';
import { parseCsv } from 'src/services/imports/csv';

/**
 * Pick a CSV, read as UTF-8 text, parse briefly to get headers/rows count,
 * then upload via uploadText (string-only, no Blob/ArrayBuffer).
 */
export async function pickParseAndUploadProductsCsv(venueId:string) {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
    multiple: false,
    copyToCacheDirectory: true,
  });

  if (res.canceled) return { cancelled: true };

  const file = res.assets?.[0];
  if (!file || !file.uri) throw new Error('No file chosen');
  const filename = file.name || 'products.csv';

  // Read as string (UTF-8)
  const text = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });

  // Light parse just to report counts (no heavy processing yet)
  const { headers, rows } = parseCsv(text);

  // Upload as text (data_url path under the hood)
  const up = await uploadText(venueId, filename, text, 'text/csv');

  return {
    cancelled: false,
    filename,
    headersCount: headers.length,
    rowsCount: rows.length,
    storagePath: up.fullPath,
    downloadURL: up.downloadURL || null,
  };
}
