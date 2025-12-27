// @ts-nocheck
// Legacy service shim: kept for backwards compatibility during migration.
// Persistence now lives in domain repo.
import { OrdersRepo } from '../../domain/orders/orders.repo';

export async function deleteDraft(venueId: string, orderId: string): Promise<void> {
  return OrdersRepo.deleteDraft(venueId, orderId);
}

export default deleteDraft;
