export type InvoiceLine = {
  name: string;
  qty: number;
  unitPrice?: number;
  code?: string;
  total?: number;
  unit?: string;
};

const DATE_RE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
const NUMERIC_RE = /^\d+(\.\d+)?$/;
const CURRENCY_RE = /^[\$NZ]{1,3}[\d,]+(\.\d{2})?$/;
const FINANCIAL_TERMS = /^(subtotal|total|gst|tax|freight|delivery|shipping|due|balance|payment|terms|invoice|order|account|abn|nzbn|po\b|credit|discount|surcharge|fee|charge|amount|price)/i;

export function filterInvoiceLines<T extends InvoiceLine>(lines: T[]): T[] {
  return lines.filter(line => {
    const name = (line.name ?? "").trim();
    if (name.length < 3) return false;
    if (line.qty <= 0 || line.qty > 10000) return false;
    if (DATE_RE.test(name)) return false;
    if (NUMERIC_RE.test(name)) return false;
    if (CURRENCY_RE.test(name)) return false;
    if (FINANCIAL_TERMS.test(name)) return false;
    return true;
  });
}
