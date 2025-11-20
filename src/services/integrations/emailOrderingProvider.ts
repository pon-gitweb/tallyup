import { OrderingProvider, Order } from './interfaces';

// Minimal email fallback provider: generates an idempotency key and returns it as supplierOrderId.
// Server should actually send the email. Here we only provide a placeholder for client flow continuity.
export class EmailOrderingProvider implements OrderingProvider {
  constructor(private readonly supplierEmail: string) {}

  async submitOrder(order: Order): Promise<{ supplierOrderId: string }> {
    const supplierOrderId = order.idempotencyKey || `HostiOrder-${order.id}-v1`;
    // In a real build, call your Cloud Function:
    // await fetch(https://.../sendSupplierOrderEmail, { method:'POST', body: JSON.stringify({ to: this.supplierEmail, order, supplierOrderId }) })
    console.log('[EmailOrderingProvider] would email order to', this.supplierEmail, supplierOrderId);
    return { supplierOrderId };
  }
}
