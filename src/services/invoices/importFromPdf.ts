// Phase-1: Pick PDF -> upload to Storage -> call CF -> map to order lines
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { fetchOrderWithLines, InvoiceLineInput } from './invoices';
import { uploadPdfFileToStorage } from '../uploads/uploadPdfFileToStorage';
import { processInvoicesPdf } from './processInvoicesPdf';

export type ImportResult = {
  invoiceNumber?: string | null;
  invoiceDateISO?: string | null;
  lines: InvoiceLineInput[];
};

export async function importInvoiceFromPdf(venueId: string, orderId: string): Promise<ImportResult> {
  // 1) Pick a single PDF
  const pick = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (pick.canceled || !pick.assets?.length) {
    throw new Error('Picker cancelled or no file selected.');
  }
  const asset = pick.assets[0];
  const uri = asset.uri;
  if (!uri) throw new Error('No file URI from picker.');

  // 2) Read as base64
  const pdfBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

  // 3) Upload to Storage under the allowed path
  const { storagePath } = await uploadPdfFileToStorage(venueId, orderId, pdfBase64);

  // 4) Process via Cloud Function
  const parsed = await processInvoicesPdf({ venueId, orderId, storagePath });

  // 5) Fetch order + lines to map matches -> InvoiceLineInput
  const { lines: orderLines } = await fetchOrderWithLines(venueId, orderId);

  // Build index by productId and by "best guess" name (lowercased)
  const byProductId = new Map(orderLines.map(l => [l.productId, l]));
  const byName = new Map(orderLines.map(l => [(l.productName || '').trim().toLowerCase(), l]));

  const outLines: InvoiceLineInput[] = [];

  for (const pl of (parsed.lines || [])) {
    const qty = Number(pl.qty || 0);
    const cost = Number(pl.unitPrice || 0);
    if (qty <= 0) continue;

    // Prefer exact lineId from the matcher (best)
    let ord = pl.matched?.lineId
      ? orderLines.find(ol => ol.id === pl.matched!.lineId)
      : undefined;

    // Next prefer productId match
    if (!ord && pl.matched?.productId) {
      ord = byProductId.get(pl.matched.productId);
    }

    // Last resort: name match (case-insensitive)
    if (!ord && pl.name) {
      ord = byName.get(String(pl.name).trim().toLowerCase());
    }

    if (!ord) {
      // Phase-1: conservative — skip unknowns (no creation, no loose posts)
      // (Later we can surface these as "Unmatched" for user review)
      continue;
    }

    outLines.push({
      lineId: ord.id,
      productId: ord.productId,
      productName: ord.productName,
      qty,
      cost,
    });
  }

  // Pull a couple of top-level hints (optional)
  const invoiceNumber = (parsed.invoice?.poNumber ?? null) as string | null;
  // Prefer parsed.poDate (YYYY-MM-DD) if present; else null so UI doesn’t mislead
  const invoiceDateISO = (parsed.invoice?.poDate ?? null) as string | null;

  return { invoiceNumber, invoiceDateISO, lines: outLines };
}
