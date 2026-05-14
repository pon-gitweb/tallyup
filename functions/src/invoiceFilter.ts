export type InvoiceLine = {
  name: string;
  qty: number;
  unitPrice?: number;
  code?: string;
  total?: number;
  unit?: string;
};

// Dates: 1/4/2025, 01-04-25 etc.
const DATE_RE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;

// Pure numbers with optional decimal: "15", "6.22"
const NUMERIC_RE = /^\d+(\.\d+)?$/;

// Currency-prefixed numbers: "$6.22", "NZ15.00"
const CURRENCY_RE = /^[\$NZ]{1,3}[\d,]+(\.\d{2})?$/;

// Comma-formatted numbers (with or without $ prefix and cents): "6,220.00", "$1,500"
const FORMATTED_NUMBER_RE = /^\$?[\d,]+\.?\d{0,2}$/;

// All-caps unit-of-measure codes with no spaces (2–4 chars, letters only): EA, PKT, BOT, CTN, KG
const UNIT_CODE_RE = /^[A-Z]{2,4}$/;

// Pure code/reference lines: all-caps + digits + hyphens/slashes, no lowercase or spaces, < 8 chars
const CODE_ONLY_RE = /^[A-Z0-9\-\/]+$/;

// Financial / administrative terms that start a line
const FINANCIAL_TERMS = /^(sub[\s\-]?total|total|gst|tax|vat|freight|delivery|shipping|due|balance|payment|terms|invoice|order|account|abn|nzbn|po\b|credit|discount|surcharge|fee|charge|amount|price|to pay|amount due|balance due|handling|paid|owing|carton)/i;

export function filterInvoiceLines<T extends InvoiceLine>(lines: T[]): T[] {
  return lines.filter(line => {
    const name = (line.name ?? "").trim();

    // Must have a meaningful name
    if (name.length < 3) return false;

    // Qty must be a finite positive number — NaN passes the <= 0 check, so test explicitly
    if (!Number.isFinite(line.qty) || line.qty <= 0 || line.qty > 10000) return false;

    // Date patterns
    if (DATE_RE.test(name)) return false;

    // Pure numeric / currency / formatted-number values
    if (NUMERIC_RE.test(name)) return false;
    if (CURRENCY_RE.test(name)) return false;
    if (FORMATTED_NUMBER_RE.test(name)) return false;

    // Financial / admin terms
    if (FINANCIAL_TERMS.test(name)) return false;

    // Standalone unit-of-measure codes (no spaces): EA, PKT, BOT, CTN, KG, etc.
    if (UNIT_CODE_RE.test(name)) return false;

    // Short code/reference-only strings (no lowercase or spaces, < 8 chars): FAK, 1010-00, etc.
    if (CODE_ONLY_RE.test(name) && name.length < 8) return false;

    return true;
  });
}
