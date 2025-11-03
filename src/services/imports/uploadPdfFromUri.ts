// Expo-safe PDF upload helper: never uses Blob/ArrayBuffer on client.
import * as FileSystem from 'expo-file-system';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';

// Example path: `venues/${venueId}/orders/${orderId}/invoices/${Date.now()}.pdf`
export async function uploadPdfFromUri(storagePath: string, fileUri: string): Promise<string> {
  // 1) Read the file as base64 on-device (Expo-safe)
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });

  // 2) Wrap it as a data URL to avoid Blob
  const dataUrl = `data:application/pdf;base64,${base64}`;

  // 3) Upload via Firebase Storage using the 'data_url' format
  const storage = getStorage();
  const r = ref(storage, storagePath);
  await uploadString(r, dataUrl, 'data_url');

  // 4) Return a durable URL to hand to the server
  return await getDownloadURL(r);
}
