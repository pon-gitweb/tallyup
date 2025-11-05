export type InvoiceLineType =
  | 'product'
  | 'freight'
  | 'surcharge'
  | 'ullage'
  | 'deposit_returnable'
  | 'discount'
  | 'tax'
  | 'other';

export type ParsedInvoiceLine = {
  code?: string;
  name: string;
  qty: number;
  unitPrice?: number;
  lineType?: InvoiceLineType; // optional; classifier may set it
};

export type OrderLine = {
  id: string;
  productId?: string;
  name?: string;
  qty?: number;
  unitCost?: number;
};

export type ReconcileOptions = {
  /** Acceptable price difference per-unit (e.g. 0.02 = 2%) */
  priceTolerancePct?: number;
};

export type ReconcileBuckets = {
  matchedOk: Array<{
    name: string;
    orderQty: number;
    orderUnitCost: number;
    invoiceQty: number;
    invoiceUnitPrice: number;
  }>;
  qtyVariance: Array<{
    name: string;
    orderQty: number;
    invoiceQty: number;
    orderUnitCost: number;
  }>;
  priceVariance: Array<{
    name: string;
    orderUnitCost: number;
    invoiceUnitPrice: number;
    qty: number;
    deltaPct: number;
  }>;
  unknownItems: ParsedInvoiceLine[];  // not found in order
  missingItems: Array<{
    name: string;
    orderQty: number;
    orderUnitCost: number;
  }>;
  charges: {
    freight: ParsedInvoiceLine[];
    surcharge: ParsedInvoiceLine[];
    ullage: ParsedInvoiceLine[];
    deposit_returnable: ParsedInvoiceLine[];
    discount: ParsedInvoiceLine[];
    tax: ParsedInvoiceLine[];
    other: ParsedInvoiceLine[];
    total: number;
  };
  totals: {
    itemsSubTotal: number;   // sum(invoiceQty * invoiceUnitPrice) for product lines
    chargesTotal: number;    // sum of all charges
    grandTotal: number;      // itemsSubTotal + chargesTotal
  };
  flags: {
    hasDeposits: boolean;
    hasUllage: boolean;
    hasFreight: boolean;
  };
};
