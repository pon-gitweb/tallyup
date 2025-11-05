import { uploadUriViaApi } from '../imports/uploadViaApi';

/**
 * Upload a CSV file (by URI) to Storage at:
 *   uploads/{venueId}/orders/{orderId}/invoices/{ts}-{safe}.csv
 * Returns { fullPath, downloadURL }
 */
export async function uploadInvoiceCsv(venueId: string, orderId: string, fileUri: string, fileName: string = 'invoice.csv') {
  if (!venueId || !orderId) throw new Error('uploadInvoiceCsv: missing venueId/orderId');
  if (!fileUri || !fileUri.startsWith('file')) throw new Error('uploadInvoiceCsv: expected a file URI');

  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const destPath = `uploads/${venueId}/orders/${orderId}/invoices/${Date.now()}-${safe}`;
  return uploadUriViaApi({ fileUri, destPath, contentType: 'text/csv' });
}

/**
 * Upload a PDF file (by URI) to Storage at:
 *   uploads/{venueId}/orders/{orderId}/invoices/{ts}-{safe}.pdf
 * Returns { fullPath, downloadURL }
 */
export async function uploadInvoicePdf(venueId: string, orderId: string, fileUri: string, fileName: string = 'invoice.pdf') {
  if (!venueId || !orderId) throw new Error('uploadInvoicePdf: missing venueId/orderId');
  if (!fileUri || !fileUri.startsWith('file')) throw new Error('uploadInvoicePdf: expected a file URI');

  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const destPath = `uploads/${venueId}/orders/${orderId}/invoices/${Date.now()}-${safe}`;
  return uploadUriViaApi({ fileUri, destPath, contentType: 'application/pdf' });
}
