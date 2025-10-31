// Expo-safe CSV uploader using data_url (no Blob)
import { getApp } from 'firebase/app';
import { getStorage, ref as sref, uploadString, getDownloadURL } from 'firebase/storage';

export async function uploadCsvTextToStorage(venueId: string, orderId: string, csvText: string): Promise<{storagePath:string; downloadURL:string}> {
  const storage = getStorage(getApp());
  const ts = Date.now();
  const path = `venues/${venueId}/invoices/raw/${orderId}/${ts}.csv`;
  const dataUrl = `data:text/csv;base64,${globalThis.btoa(unescape(encodeURIComponent(csvText)))}`;
  const ref = sref(storage, path);
  await uploadString(ref, dataUrl, 'data_url');
  const downloadURL = await getDownloadURL(ref);
  return { storagePath: path, downloadURL };
}
