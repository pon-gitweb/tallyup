/**
 * Phase-1 PDF upload helper.
 * Uploads a picked PDF into:
 *   venues/{venueId}/invoices/raw/{orderId}/{filename}
 */
import { getStorage, ref, uploadBytes } from 'firebase/storage';

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

  // Fetch URI -> Blob (Expo-safe)
  const resp = await fetch(fileUri);
  if (!resp.ok) throw new Error(`Failed to read file: ${resp.status}`);
  const blob = await resp.blob();

  const storage = getStorage();
  const finalName =
    safeName(fileName || `invoice_${Date.now()}.pdf`).replace(/\.pdf$/i, '') + '.pdf';
  const fullPath = `venues/${venueId}/invoices/raw/${orderId}/${finalName}`;
  const storageRef = ref(storage, fullPath);

  await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  return { fullPath, fileName: finalName };
}
