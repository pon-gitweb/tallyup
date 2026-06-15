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

// ── Document receiving (packing slips / delivery notes / pending deliveries) ──

export type DocumentType =
  | 'TAX_INVOICE'
  | 'PACKING_SLIP'
  | 'DELIVERY_NOTE'
  | 'CREDIT_NOTE'
  | 'PURCHASE_ORDER'
  | 'UNKNOWN';

export type PendingDeliveryStatus = 'awaiting_invoice' | 'invoice_confirmed';

export interface PendingDeliveryLine {
  productId?: string | null;
  name: string;
  productName?: string;
  qty: number;
  unit?: string | null;
  sku?: string | null;
  unitCost: number;
  lineTotal: number;
  // True until an invoice confirms the real cost for this line.
  provisionalCost: boolean;
  matched: boolean;
}

export interface PendingDeliveryDoc {
  type: 'packing_slip' | 'delivery_note';
  status: PendingDeliveryStatus;
  supplierName?: string | null;
  supplierId?: string | null;
  packingSlipRef?: string | null;
  // Invoice number printed on the packing slip, if present.
  invoiceRef?: string | null;
  deliveryDate?: string | null;
  lines: PendingDeliveryLine[];
  invoiceId?: string | null;
  costConfirmed: boolean;
  provisionalCost: number;
  matchedOrderId?: string | null;
  // Courier/delivery-note specific fields (no product data).
  courier?: string | null;
  trackingNumber?: string | null;
  packageCount?: number | null;
}
