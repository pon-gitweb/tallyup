// Shared invoice / line item types for the venue invoices collection
// (venues/{venueId}/invoices/{invoiceId} and its lines subcollection).

export type InvoiceType = 'invoice' | 'credit_note';

export type ReceivedAs = 'purchased' | 'promotional' | 'sample';

export interface InvoiceLineItem {
  productId?: string | null;
  name?: string;
  productName?: string;
  qty: number;
  unitCost?: number;
  unitPrice?: number;
  cost?: number;
  lineTotal?: number;
  // Default 'purchased'. 'promotional'/'sample' lines are received at zero cost
  // and excluded from invoice totals / COGS.
  receivedAs?: ReceivedAs;
}

export interface InvoiceDoc {
  // Default 'invoice'. 'credit_note' lines carry negative qty/amounts.
  type?: InvoiceType;
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  totalAmount?: number;
  // Set when a credit_note relates to a known prior invoice.
  originalInvoiceId?: string | null;
  notes?: string | null;
}
