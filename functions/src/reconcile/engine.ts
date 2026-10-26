/**
 * Reconcile engine: pure orchestration of window, reports, sales, deliveries,
 * and item classification for a single stocktake cycle.
 * No Firebase imports.
 */

import * as crypto from 'crypto';
import { windowDates, deliveryDates } from './tradingWindow';
import { selectReports, ReportPeriod, SelectResult } from './selectReports';
import { aggregateSales, SalesMatchDoc, AggregatedSalesResult } from './aggregateSales';
import { aggregateDeliveries, InvoiceInput, AggregatedDeliveriesResult } from './aggregateDeliveries';
import { classifyItems, SnapshotItemInput, ClassifiedItem } from './classify';

export interface ReconcileInputs {
  tz: string;
  closedWeekdays: number[];
  countTiming: 'pre_service' | 'post_service';
  openingCountStart: Date;
  thisCountStart: Date;
  snapshotItems: SnapshotItemInput[];
  salesReports: (ReportPeriod & {
    /** Total revenue for this report period (from salesReport.rawLines). */
    totalRevenue?: number;
  })[];
  /** Match docs keyed by reportId. */
  matchDocsByReportId: Record<string, SalesMatchDoc>;
  invoices: InvoiceInput[];
  posProductMappings: { id?: string; productId?: string | null; mappingType?: string | null }[];
  /** productId → survivorId (walked from the products collection mergedInto chain). */
  mergedInto: Record<string, string>;
}

export interface ReconcileSummary {
  totalItems: number;
  byStatus: Record<string, number>;
  totalShortfall: number;
  totalShortfallDollars: number | null;
  impliedDeliveryCount: number;
  /**
   * Matched revenue / total revenue across attached reports.
   * numerator = sum of matches[].gross in attached reports' match docs.
   * denominator = sum of salesReport.totalRevenue for attached reports.
   * Both use the raw 'gross' field from rawLines (GST-exclusive for Bustle,
   * GST-inclusive assumed for Square). Never mix grossIncl into the denominator.
   * null when denominator is 0 or no attached reports.
   */
  linkedSalesPct: number | null;
}

export interface ReconcileResult {
  window: string[];
  reports: SelectResult;
  sales: AggregatedSalesResult;
  deliveries: AggregatedDeliveriesResult;
  items: ClassifiedItem[];
  summary: ReconcileSummary;
  inputsFingerprint: string;
}

export function reconcileSnapshot(inputs: ReconcileInputs): ReconcileResult {
  const {
    tz, closedWeekdays, countTiming,
    openingCountStart, thisCountStart,
    snapshotItems, salesReports, matchDocsByReportId,
    invoices, posProductMappings, mergedInto,
  } = inputs;

  // 1. Trading window
  const window = windowDates(openingCountStart, thisCountStart, tz, closedWeekdays, countTiming);

  // 2. Report selection
  const reports = selectReports(window, tz, closedWeekdays, salesReports);

  // 3. Aggregate sales from attached reports only
  const attachedMatchDocs = reports.attached
    .map(r => matchDocsByReportId[r.id])
    .filter((d): d is SalesMatchDoc => !!d);
  const sales = aggregateSales(attachedMatchDocs, mergedInto);

  // 4. Aggregate deliveries (all calendar dates, no closed-day filtering)
  const delDates = deliveryDates(openingCountStart, thisCountStart, tz, countTiming);
  const deliveries = aggregateDeliveries(invoices, delDates, tz, mergedInto);

  // 5. Classify items
  const items = classifyItems({
    items: snapshotItems,
    soldByProductId: sales.soldByProductId,
    receivedByProductId: deliveries.receivedByProductId,
    flagsByProductId: sales.flagsByProductId,
    posProductMappings,
    coverageComplete: reports.coverageComplete,
    mergedInto,
  });

  // 6. Summary
  const byStatus: Record<string, number> = {};
  let totalShortfall = 0;
  let totalShortfallDollars: number | null = null;
  let impliedDeliveryCount = 0;

  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    if (item.shortfall != null && item.shortfall > 0) {
      totalShortfall += item.shortfall;
      if (item.shortfallDollars != null) {
        totalShortfallDollars = (totalShortfallDollars ?? 0) + item.shortfallDollars;
      }
    }
    if (item.impliedDelivery != null && item.impliedDelivery > 0) {
      impliedDeliveryCount++;
    }
  }

  // linkedSalesPct: matched revenue / total revenue across attached reports
  let matchedRevenue = 0;
  let totalRevenue = 0;
  let hasTotalRevenue = false;
  for (const r of reports.attached) {
    const matchDoc = matchDocsByReportId[r.id];
    if (matchDoc?.matches) {
      for (const m of matchDoc.matches) {
        matchedRevenue += m.gross ?? 0;
      }
    }
    const report = salesReports.find(sr => sr.id === r.id);
    if (report?.totalRevenue != null) {
      totalRevenue += report.totalRevenue;
      hasTotalRevenue = true;
    }
  }
  const linkedSalesPct = (hasTotalRevenue && totalRevenue > 0)
    ? (matchedRevenue / totalRevenue) * 100
    : null;

  const summary: ReconcileSummary = {
    totalItems: items.length,
    byStatus,
    totalShortfall,
    totalShortfallDollars,
    impliedDeliveryCount,
    linkedSalesPct,
  };

  // 7. Fingerprint
  const inputsFingerprint = computeFingerprint(inputs);

  return { window, reports, sales, deliveries, items, summary, inputsFingerprint };
}

function computeFingerprint(inputs: ReconcileInputs): string {
  const stable = {
    tz: inputs.tz,
    closedWeekdays: [...inputs.closedWeekdays].sort(),
    countTiming: inputs.countTiming,
    openingCountStart: inputs.openingCountStart.getTime(),
    thisCountStart: inputs.thisCountStart.getTime(),
    snapshotItems: inputs.snapshotItems.map(i => ({
      productId: i.productId ?? null,
      name: i.name ?? null,
      openingCount: i.openingCount,
      actualClosing: i.actualClosing,
      costPrice: i.costPrice ?? null,
    })),
    salesReports: inputs.salesReports.map(r => ({
      id: r.id,
      periodStart: r.periodStart.getTime(),
      periodEnd: r.periodEnd.getTime(),
      totalRevenue: r.totalRevenue ?? null,
    })),
    matchDocsByReportId: inputs.matchDocsByReportId,
    invoices: inputs.invoices
      .map(i => ({
        id: i.id,
        dateMs: toDateMs(i.invoiceDateTimestamp),
        type: i.type ?? null,
        lines: (i.lines ?? []).map(l => ({
          productId: l.productId ?? null,
          qty: l.qty ?? null,
          quantity: l.quantity ?? null,
          caseSize: l.caseSize ?? null,
          unit: l.unit ?? null,
        })).sort((a, b) => (a.productId ?? '').localeCompare(b.productId ?? '')),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    posProductMappings: inputs.posProductMappings
      .map(m => ({ id: m.id ?? '', productId: m.productId ?? null, mappingType: m.mappingType ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    mergedInto: inputs.mergedInto,
  };
  const json = JSON.stringify(stable, sortedReplacer);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function toDateMs(ts: { toDate(): Date } | Date | null | undefined): number | null {
  if (!ts) return null;
  const d = typeof (ts as any).toDate === 'function' ? (ts as any).toDate() as Date : ts as Date;
  return d.getTime();
}

function sortedReplacer(_key: string, value: any): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}
