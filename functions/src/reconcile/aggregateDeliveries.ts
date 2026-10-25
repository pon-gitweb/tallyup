/**
 * Pure aggregation of deliveries from invoice docs.
 * No Firebase imports.
 */

import { toTzDate } from './tradingWindow';

export interface InvoiceLineInput {
  productId?: string | null;
  qty?: number | null;
  quantity?: number | null;
  caseSize?: number | null;
  unit?: string | null;
}

export interface InvoiceInput {
  id: string;
  /** Firestore Timestamp (has .toDate()) or Date. */
  invoiceDateTimestamp: { toDate(): Date } | Date | null;
  type?: string | null;
  lines?: InvoiceLineInput[];
}

export interface AggregatedDeliveriesResult {
  /** Summed line qty per productId for invoices in the window. */
  receivedByProductId: Record<string, number>;
  /** Invoice lines with a productId but no usable qty excluded due to ambiguity. */
  ambiguousLines: number;
  /** Invoice lines without a productId. */
  unlinkedLines: number;
}

/**
 * Aggregate received quantities from invoices.
 *
 * Quantity semantics: use line.qty (same as snapshotWriter.ts:218-219 and
 * enrich-area-items). No caseSize-to-unit conversion is applied.
 *
 * Excluded (ambiguous): lines where caseSize is a positive number — the qty is
 * in cases without a confirmed per-unit breakdown.
 *
 * Excluded (unlinked): lines with no productId.
 *
 * Credit notes (type === 'credit_note') are excluded entirely.
 */
export function aggregateDeliveries(
  invoices: InvoiceInput[],
  windowDates: string[],
  tz: string,
): AggregatedDeliveriesResult {
  const windowSet = new Set(windowDates);
  const receivedByProductId: Record<string, number> = {};
  let ambiguousLines = 0;
  let unlinkedLines = 0;

  for (const inv of invoices) {
    if (inv.type === 'credit_note') continue;

    const rawDate = inv.invoiceDateTimestamp;
    if (!rawDate) continue;
    const jsDate = typeof (rawDate as any).toDate === 'function'
      ? (rawDate as any).toDate() as Date
      : rawDate as Date;
    const invDateStr = toTzDate(jsDate, tz);
    if (!windowSet.has(invDateStr)) continue;

    for (const line of inv.lines ?? []) {
      if (!line.productId) {
        unlinkedLines++;
        continue;
      }

      const cs = typeof line.caseSize === 'number' ? line.caseSize : null;
      if (cs != null && cs > 0) {
        ambiguousLines++;
        continue;
      }

      const qty = typeof line.qty === 'number' ? line.qty
                : typeof line.quantity === 'number' ? line.quantity
                : 0;
      if (qty <= 0) continue;

      receivedByProductId[line.productId] =
        (receivedByProductId[line.productId] ?? 0) + qty;
    }
  }

  return { receivedByProductId, ambiguousLines, unlinkedLines };
}
