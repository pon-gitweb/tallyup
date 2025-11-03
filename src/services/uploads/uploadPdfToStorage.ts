import { uploadFileAsBase64 } from './uploadFileAsBase64';

export async function uploadPdfToStorage(args: { venueId: string; orderId: string; fileUri: string; fileName?: string; }) {
  const { venueId, orderId, fileUri, fileName } = args;
  return uploadFileAsBase64({
    venueId,
    orderId,
    fileUri,
    fileName: fileName || 'invoice.pdf',  // ensures content-type inference
  });
}
