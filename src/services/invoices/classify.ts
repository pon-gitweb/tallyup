import type { InvoiceLineType, ParsedInvoiceLine } from './types';

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
