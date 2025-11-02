/**
 * Phase-1 PDF upload helper (Blob-free).
 * Uploads a picked PDF into:
 *   venues/{venueId}/invoices/raw/{orderId}/{filename}
 *
 * Uses Expo FileSystem to read base64 and Firebase Storage uploadString('base64')
 * to avoid Blob/ArrayBuffer pitfalls on React Native.
 */
import * as FileSystem from 'expo-file-system';
import { getStorage, ref, uploadString } from 'firebase/storage';

function safeName(name: string) {
  return String(name || 'invoice.pdf')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120);
}

export async function uploadPdfToStorage(opts: {
  venueId: string;
  orderId: string;
  fileUri: string;
  fileName?: string;
}) {
  const { venueId, orderId, fileUri, fileName } = opts;
  if (!venueId || !orderId) {
    throw new Error('uploadPdfToStorage: missing venueId or orderId');
  }
  if (!fileUri) {
    throw new Error('uploadPdfToStorage: missing fileUri');
  }

  // Read the PDF as base64 (Expo-safe, no Blob)
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const storage = getStorage();
  const finalName =
    safeName(fileName || `invoice_${Date.now()}.pdf`).replace(/\.pdf$/i, '') + '.pdf';
  const fullPath = `venues/${venueId}/invoices/raw/${orderId}/${finalName}`;
  const storageRef = ref(storage, fullPath);

  await uploadString(storageRef, base64, 'base64', { contentType: 'application/pdf' });
  return { fullPath, fileName: finalName };
}
