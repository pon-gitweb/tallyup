export type OrderStatus = 'draft'|'submitted'|'received'|'cancelled';

export type Order = {
  id: string;
  status: OrderStatus;
  supplierId: string | null;
  createdAt?: any;
  submittedAt?: any;
  receivedAt?: any;
};

export type SuggestedLine = {
  productId: string;
  productName?: string|null;
  qty: number;
  cost: number;
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string|null;
};

export type CompatBucket = {
  [productId: string]: SuggestedLine | any;
  items: { [productId: string]: SuggestedLine };
  lines: SuggestedLine[];
};

export type SuggestedLegacyMap = Record<string, CompatBucket>;
