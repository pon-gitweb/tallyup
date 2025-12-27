// @ts-nocheck
// Legacy service shim: kept for backwards compatibility during migration.
// Persistence now lives in domain repo.
import { OrdersRepo } from '../../domain/orders/orders.repo';

export type SubmittedOrderLite = {
  id: string;
  poNumber?: string|null;
  supplierName?: string|null;
  createdAt?: any;
};

export async function listSubmittedOrders(venueId: string, max: number = 100): Promise<SubmittedOrderLite[]> {
  return OrdersRepo.listSubmittedOrders(venueId, max);
}

export default listSubmittedOrders;
