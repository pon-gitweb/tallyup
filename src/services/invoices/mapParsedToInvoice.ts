import type { ParsedInvoiceLine } from './processInvoicesPdf';
import type { InvoiceLineInput } from '../invoices';

export function mapParsedToInvoiceLines(parsed: ParsedInvoiceLine[]): InvoiceLineInput[] {
  // Conservative Phase-1: only include lines we can match to either an order lineId or a productId.
  const out: InvoiceLineInput[] = [];
  for (const p of parsed || []) {
    const qty = Number(p.qty || 0);
    const cost = Number(p.unitPrice || 0);
    const lineId = p.matched?.lineId || '';     // prefer exact order line link if present
    const productId = p.matched?.productId || '';

    if (!lineId && !productId) continue;        // skip unmatched in Phase-1
    out.push({
      lineId: lineId || productId,             // keep deterministic id for upsert path
      productId: productId || 'unknown',
      productName: p.name || undefined,
      qty,
      cost,
    });
  }
  return out;
}
