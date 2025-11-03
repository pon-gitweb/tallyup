// Upload CSV text via base64 (no Blob, no ArrayBuffer)
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';

export async function uploadCsvText(venueId: string, orderId: string, fileName: string, csvText: string) {
  const storage = getStorage();
  const fullPath = `venues/${venueId}/invoices/raw/${orderId}/${fileName}`;
  const r = ref(storage, fullPath);

  // Convert UTF-8 text to base64 in JS (Buffer is polyfilled in RN)
  const base64 = Buffer.from(csvText, 'utf8').toString('base64');

  await uploadString(r, base64, 'base64', { contentType: 'text/csv' });
  const url = await getDownloadURL(r);
  return { fullPath, downloadURL: url };
}
