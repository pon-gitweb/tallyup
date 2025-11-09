// @ts-nocheck
import { uploadUriViaApi } from '../imports/uploadViaApi';

/**
 * Upload an invoice file (CSV or PDF) when there is NO orderId yet.
 * Path: uploads/{venueId}/fast-receive/{ts}-{safe}.{ext}
 * Returns { fullPath, downloadURL }
 */
export async function uploadFastInvoice(venueId: string, fileUri: string, fileName: string, contentType: 'text/csv'|'application/pdf') {
  if (!venueId) throw new Error('uploadFastInvoice: missing venueId');
  if (!fileUri || !fileUri.startsWith('file')) throw new Error('uploadFastInvoice: expected a file URI');

  const safe = (fileName || 'invoice').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const destPath = `uploads/${venueId}/fast-receive/${Date.now()}-${safe}`;

  try {
    const out = await uploadUriViaApi({ fileUri, destPath, contentType });
    if (__DEV__) console.log('[FastReceive][Storage] OK', { destPath, contentType, outFullPath: out?.fullPath });
    return out;
  } catch (e:any) {
    console.log('[FastReceive][Storage] FAIL', { destPath, contentType, message: e?.message || String(e) });
    throw e;
  }
}
