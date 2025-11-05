// Strict URI-only invoice uploaders.
// Mirrors working Products CSV uploader (storageTextUpload).

import { uploadCsvFromUri, uploadPdfFromUri } from '../imports/storageTextUpload';

export async function uploadInvoiceCsv(
  venueId: string,
  orderId: string,
  fileUri: string,
  fileName?: string
): Promise<{ fullPath: string; downloadURL: string }> {
  if (!venueId || !orderId) throw new Error('uploadInvoiceCsv: missing venueId/orderId');
  if (!fileUri) throw new Error('uploadInvoiceCsv: missing fileUri');
  // Hard guard: if someone passes CSV text by mistake, fail fast with a clear error
  if (/\n/.test(fileUri) || /,/.test(fileUri)) {
    throw new Error('uploadInvoiceCsv: expected a file URI, but received CSV text');
  }
  const safeName = (fileName || 'invoice.csv').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const ts = Date.now();
  const dest = `uploads/${venueId}/invoices/${orderId}/${ts}-${safeName}`;
  return uploadCsvFromUri(fileUri, dest);
}

export async function uploadInvoicePdf(
  venueId: string,
  orderId: string,
  fileUri: string,
  fileName?: string
): Promise<{ fullPath: string; downloadURL: string }> {
  if (!venueId || !orderId) throw new Error('uploadInvoicePdf: missing venueId/orderId');
  if (!fileUri) throw new Error('uploadInvoicePdf: missing fileUri');
  if (/\n/.test(fileUri) || /,/.test(fileUri)) {
    throw new Error('uploadInvoicePdf: expected a file URI, but received inline text');
  }
  const safeName = (fileName || 'invoice.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const ts = Date.now();
  const dest = `uploads/${venueId}/invoices/${orderId}/${ts}-${safeName}`;
  return uploadPdfFromUri(fileUri, dest);
}
