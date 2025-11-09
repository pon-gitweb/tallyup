export type NormalizedSalesLine = {
  sku: string|null;
  barcode: string|null;
  name: string;
  qtySold: number;
  gross: number|null;
  net: number|null;
  tax: number|null;
};

export type NormalizedSalesReport = {
  source: 'csv'|'pdf';
  period: { start?: string|null; end?: string|null };
  lines: NormalizedSalesLine[];
  warnings?: string[];
};
