// Expo-safe PDF uploader using data_url
import { getApp } from 'firebase/app';
import { getStorage, ref as sref, uploadString, getDownloadURL } from 'firebase/storage';

export async function uploadPdfToStorage(venueId: string, orderId: string, pdfBytesBase64: string): Promise<{storagePath:string; downloadURL:string}> {
  const storage = getStorage(getApp());
  const ts = Date.now();
  const path = `venues/${venueId}/invoices/raw/${orderId}/${ts}.pdf`;
  const dataUrl = `data:application/pdf;base64,${pdfBytesBase64}`;
  const ref = sref(storage, path);
  await uploadString(ref, dataUrl, 'data_url');
  const downloadURL = await getDownloadURL(ref);
  return { storagePath: path, downloadURL };
}
