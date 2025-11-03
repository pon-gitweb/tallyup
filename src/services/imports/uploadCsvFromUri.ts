import * as FileSystem from 'expo-file-system';
import { getApp } from 'firebase/app';
import { getStorage, ref, uploadString } from 'firebase/storage';

/**
 * Expo-safe CSV upload: reads the picked file as base64 and uploads via data_url.
 * Returns the storage path you should pass to processInvoicesCsv.
 */
export async function uploadCsvFromUri(opts: {
  fileUri: string;
  storagePath: string; // e.g. `uploads/invoices/${orderId}.csv`
}): Promise<{ storagePath: string }> {
  const { fileUri, storagePath } = opts;
  if (!fileUri) throw new Error('uploadCsvFromUri: missing fileUri');
  if (!storagePath) throw new Error('uploadCsvFromUri: missing storagePath');

  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
  const dataUrl = `data:text/csv;base64,${base64}`;

  const app = getApp();
  const storage = getStorage(app);
  const r = ref(storage, storagePath);
  await uploadString(r, dataUrl, 'data_url');

  return { storagePath };
}
