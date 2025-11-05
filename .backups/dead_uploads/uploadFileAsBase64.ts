import { uploadFileAsBase64 as baseUpload } from '../imports/storageTextUpload';

type Opts = {
  venueId: string;
  orderId: string;
  fileUri?: string;   // from DocumentPicker
  uri?: string;       // fallback name used in some pickers
  fileName?: string;  // infer content-type (.csv/.pdf) from name
  contentType?: string; // optional override
  cacheControl?: string;
};

function safeName(name: string): string {
  return String(name || 'invoice_upload')
    .replace(/[^\w\.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

export async function uploadFileAsBase64(opts: Opts): Promise<{ fullPath: string; downloadURL: string; }> {
  const { venueId, orderId } = opts || ({} as any);
  const fileUri = opts.fileUri || opts.uri;
  if (!venueId || !orderId) throw new Error('uploadFileAsBase64: missing venueId or orderId');
  if (!fileUri) throw new Error('uploadFileAsBase64: missing fileUri');

  const name = safeName(opts.fileName || 'invoice_upload');
  const destPath = `uploads/${venueId}/invoices/${orderId}/${name}`;

  // Delegate to the SAME uploader used by the Products CSV import.
  return baseUpload({
    destPath,
    fileUri,
    contentType: opts.contentType,   // storageTextUpload will infer when absent
    cacheControl: opts.cacheControl,
  });
}
