export type Supplier = {
  id: string;
  name?: string | null;
};

export type SuggestedLine = {
  productId: string;
  productName?: string | null;
  qty: number;                 // suggested quantity to order
  cost?: number | null;        // unit cost if known
  needsPar?: boolean;
  needsSupplier?: boolean;
  packSize?: number | null;
  reason?: string | null;      // 'no_par_zero_stock' | 'no_supplier' | etc.
};

export type SuggestedLegacyMap = Record<
  string,
  | { lines: SuggestedLine[] }
  | { items: Record<string, SuggestedLine> }
  | Record<string, SuggestedLine>
>;

export type CreateDraftsOptions = {
  createdBy?: string | null;
  guardSince?: number | null;  // ts-ms; prevent duplicate drafts newer than this
};

export type CreateDraftsResult = {
  created: Array<{ id: string; supplierId?: string | null }>;
  skippedByGuard?: boolean;
};

export type OrderStatus = 'draft' | 'submitted' | 'received';

export type OrderSummary = {
  id: string;
  venueId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status: OrderStatus;
  linesCount?: number;
  createdAt?: number;
  submittedAt?: number | null;
};

export type OrderLine = {
  productId: string;
  name?: string | null;
  qty: number;
  unitCost?: number | null;
};

export type OrderWithLines = OrderSummary & { lines: OrderLine[] };
