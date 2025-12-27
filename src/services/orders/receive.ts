// @ts-nocheck
// Legacy service shim: kept for backwards compatibility during migration.
// Persistence now lives in domain repo.
import { OrdersRepo } from '../../domain/orders/orders.repo';

export async function finalizeReceiveFromCsv(args: any) {
  return OrdersRepo.finalizeReceiveFromCsv(args);
}

export async function finalizeReceiveFromPdf(args: any) {
  return OrdersRepo.finalizeReceiveFromPdf(args);
}
