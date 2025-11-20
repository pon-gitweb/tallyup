export interface ReconRef {
  orderId: string;
  supplierOrderId?: string;
  invoiceId?: string;
  paymentId?: string;
}

export function attachSupplierOrderId(r: ReconRef, supplierOrderId: string): ReconRef {
  return { ...r, supplierOrderId };
}

export function attachInvoiceId(r: ReconRef, invoiceId: string): ReconRef {
  return { ...r, invoiceId };
}

export function attachPaymentId(r: ReconRef, paymentId: string): ReconRef {
  return { ...r, paymentId };
}
