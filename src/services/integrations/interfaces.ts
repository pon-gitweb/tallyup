export type ISODate = string;

export interface Product {
  id: string;
  name: string;
  supplierId: string;
  // GS1 / pack hierarchy (extensible)
  gtin_each?: string;
  gtin_case?: string;
  gtin_layer?: string;
  sscc_pallet?: string;
  uom?: 'ml'|'g'|'each'|'kg'|'l';
  packQty?: number; // e.g., 24 per case
  // Optional attributes
  allergens?: string[];
  ingredients?: string[];
}

export interface Price {
  productId: string;
  currency: string;
  amount: number;
  validFrom?: ISODate;
  validTo?: ISODate;
  tier?: 'tier1' | 'contract';
}

export interface Promotion {
  id: string;
  productId: string;
  title: string;
  description?: string;
  validFrom?: ISODate;
  validTo?: ISODate;
}

export interface OrderLine {
  productId: string;
  qty: number;
  // unitLevel indicates the pack unit (each/case/layer/pallet)
  unitLevel?: 'each'|'case'|'layer'|'pallet';
}

export interface Order {
  id: string;
  supplierId: string;
  venueId: string;
  createdAt: ISODate;
  lines: OrderLine[];
  currency: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface Invoice {
  id: string;
  supplierId: string;
  venueId: string;
  issuedAt: ISODate;
  total: number;
  currency: string;
}

export interface PaymentIntent {
  orderId: string;
  supplierId: string;
  amount: number;
  currency: string;
  beneficiaryRef?: string;
}

export interface CatalogProvider {
  fetchProducts(since?: ISODate, venueAccountRef?: string): Promise<Product[]>;
  fetchPrices?(venueAccountRef?: string): Promise<Price[]>;
  fetchPromotions?(): Promise<Promotion[]>;
}

export interface OrderingProvider {
  submitOrder(order: Order): Promise<{ supplierOrderId: string }>;
  getOrderStatus?(supplierOrderId: string): Promise<'received'|'accepted'|'backorder'|'shipped'|'cancelled'>;
}

export interface InvoiceProvider {
  fetchInvoices(since?: ISODate): Promise<Invoice[]>;
  fetchInvoicePdf?(invoiceId: string): Promise<string>; // URL
}

export interface PaymentRail {
  initiate(payment: PaymentIntent): Promise<{ paymentId: string; nextAction: 'redirect'|'qr'|'none' }>;
  getStatus(paymentId: string): Promise<'pending'|'success'|'failed'>;
}

export type AuthType = 'API_KEY' | 'OAUTH2' | 'BASIC' | 'NONE';

export interface AuthProvider {
  type: AuthType;
  refreshToken?(): Promise<void>;
}
