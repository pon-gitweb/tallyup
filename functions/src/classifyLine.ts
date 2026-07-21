// Mirrors src/services/invoices/classify.ts — if you change the classification
// rules, update both files. These are separate build targets that cannot share
// code directly; the duplication is intentional.

export type InvoiceLineType =
  | 'product'
  | 'freight'
  | 'surcharge'
  | 'ullage'
  | 'deposit_returnable'
  | 'discount'
  | 'tax'
  | 'other';

export interface ParsedInvoiceLine {
  name: string;
  qty: number;
  unitPrice?: number;
}

const contains = (s: string, needles: string[]) =>
  needles.some(n => s.includes(n));

export function classifyLine(line: ParsedInvoiceLine): InvoiceLineType {
  const name = (line.name || '').toLowerCase();

  if (contains(name, ['freight', 'delivery', 'courier', 'transport', 'fuel surcharge', 'logistics'])) {
    return 'freight';
  }
  if (contains(name, ['surcharge', 'card fee', 'handling fee'])) {
    return 'surcharge';
  }
  if (contains(name, ['ullage', 'breakage', 'spillage', 'wastage', 'damaged'])) {
    return 'ullage';
  }
  if (contains(name, ['keg deposit', 'deposit', 'returnable', 'chep pallet', 'pallet deposit'])) {
    return 'deposit_returnable';
  }
  if (contains(name, ['discount', 'promo', 'promotion', 'rebate'])) {
    return 'discount';
  }
  if (contains(name, ['gst', 'vat', 'tax'])) {
    return 'tax';
  }
  return 'product';
}

export function lineTotal(l?: ParsedInvoiceLine): number {
  if (!l) return 0;
  const qty = Number.isFinite(l.qty) ? Number(l.qty) : 0;
  const unit = Number.isFinite(l.unitPrice) ? Number(l.unitPrice) : 0;
  return qty * unit;
}

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export type ExcludedLineSummary = {
  type: Exclude<InvoiceLineType, 'product'>;
  label: string;
  total: number;   // sum of qty * unitPrice; 0 when unitPrice absent
  count: number;
};

const TYPE_LABELS: Record<Exclude<InvoiceLineType, 'product'>, string> = {
  freight:             'Freight',
  surcharge:           'Surcharge',
  ullage:              'Wastage/Breakage',
  deposit_returnable:  'Deposit/Returnable',
  discount:            'Discount/Rebate',
  tax:                 'Tax/GST',
  other:               'Other',
};

export function summarizeExcludedLines(
  lines: Array<{ name: string; qty: number; unitPrice?: number }>,
): ExcludedLineSummary[] {
  const grouped = new Map<Exclude<InvoiceLineType, 'product'>, { total: number; count: number }>();

  for (const line of lines) {
    const t = classifyLine(line);
    if (t === 'product') continue; // guard — callers should not pass product lines here
    const key = t as Exclude<InvoiceLineType, 'product'>;
    const acc = grouped.get(key) || { total: 0, count: 0 };
    const qty  = Number.isFinite(line.qty)       ? Number(line.qty)       : 0;
    const unit = Number.isFinite(line.unitPrice)  ? Number(line.unitPrice) : 0;
    acc.total += qty * unit;
    acc.count += 1;
    grouped.set(key, acc);
  }

  return Array.from(grouped.entries()).map(([type, { total, count }]) => ({
    type,
    label: TYPE_LABELS[type],
    total,
    count,
  }));
}

export function mergeExcludedLines(
  a: ExcludedLineSummary[],
  b: ExcludedLineSummary[],
): ExcludedLineSummary[] {
  const map = new Map<string, ExcludedLineSummary>();
  for (const e of [...a, ...b]) {
    const existing = map.get(e.type);
    if (existing) {
      existing.count += e.count;
      existing.total += e.total;
    } else {
      map.set(e.type, { ...e });
    }
  }
  return Array.from(map.values());
}
