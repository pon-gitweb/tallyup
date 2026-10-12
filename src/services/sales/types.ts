import type { CategoryTotal, ReportTotals } from './parseSalesExport';

export type NormalizedSalesLine = {
  sku: string|null;
  barcode: string|null;
  name: string;
  qtySold: number;
  /** Always a LINE TOTAL (GST incl when known). Never a unit price. */
  gross: number|null;
  /** Line total GST excl; null when the source file did not supply it. */
  net: number|null;
  tax: number|null;
  // Phase 1 additions (optional for backward compat)
  unitPrice?: number|null;
  category?: string|null;
  derived?: boolean;
};

export type NormalizedSalesReportMeta = {
  sourceFormat?: 'bustle_rich'|'bustle_items'|'generic'|'hosti_flat'|'pdf'|'square';
  parserVersion?: number|null;
  lineTotalsBasis?: 'line_total';
  gstBasis?: 'explicit'|'assumed_incl'|'unknown';
  kind?: 'items'|'summary'|'unknown';
  reportTotals?: ReportTotals|null;
  categoryTotals?: CategoryTotal[];
  fileHash?: string|null;
};

export type NormalizedSalesReport = {
  source: 'csv'|'pdf';
  period: { start?: string|null; end?: string|null };
  lines: NormalizedSalesLine[];
  warnings?: string[];
  /** Parser metadata stored inside report.meta in Firestore. */
  meta?: NormalizedSalesReportMeta;
  // Phase 1 top-level fields kept for backward compat with existing callers
  sourceFormat?: 'bustle_rich'|'bustle_items'|'generic'|'hosti_flat'|'pdf'|'square';
  parserVersion?: number;
  /** Documents that gross on every line is a line total, not a unit price. */
  lineTotalsBasis?: 'line_total';
  /** How to interpret gross relative to GST. */
  gstBasis?: 'explicit'|'assumed_incl'|'unknown';
};
