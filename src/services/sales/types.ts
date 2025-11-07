// @ts-nocheck
export type NormalizedSalesLine = {
  sku?: string | null;       // POS SKU / PLU / code if available
  barcode?: string | null;   // EAN/UPC if present
  name: string;              // item name from report
  qtySold: number;           // units sold in the period
  gross: number | null;      // gross sales (optional)
  net: number | null;        // net sales after discounts (optional)
  tax: number | null;        // tax portion (optional)
};

export type NormalizedSalesReport = {
  source: 'csv'|'pdf';
  period: { start?: string|null; end?: string|null }; // ISO strings if the server extracts them
  lines: NormalizedSalesLine[];
  warnings?: string[];
};
