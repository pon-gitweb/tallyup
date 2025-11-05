import { uploadCsvFromUri, uploadPdfFromUri } from '../imports/storageTextUpload';

function safeName(name?: string) {
  return (name || 'invoice.txt').replace(/[^\w.\-]+/g, '_').slice(0, 80);
}

export async function uploadInvoiceCsv(venueId: string, orderId: string, fileUri: string, name?: string) {
  const ts = Date.now();
  const destPath = `uploads/${venueId}/invoices/${orderId}/${ts}-${safeName(name || 'invoice.csv')}`;
  return uploadCsvFromUri(fileUri, destPath); // { fullPath, downloadURL }
}

export async function uploadInvoicePdf(venueId: string, orderId: string, fileUri: string, name?: string) {
  const ts = Date.now();
  const destPath = `uploads/${venueId}/invoices/${orderId}/${ts}-${safeName(name || 'invoice.pdf')}`;
  return uploadPdfFromUri(fileUri, destPath); // { fullPath, downloadURL }
}
