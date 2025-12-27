// src/services/orders/submit.ts
// Legacy service shim: kept for backwards compatibility during migration.
// Persistence now lives in domain repo.
import { OrdersRepo } from '../../domain/orders/orders.repo';

/**
 * Finalize an order to clean "submitted" state and scrub merge/hold flags.
 */
export async function finalizeToSubmitted(
  venueId: string,
  orderId: string,
  uid?: string
) {
  return OrdersRepo.finalizeToSubmitted(venueId, orderId, uid);
}

/** Legacy immediate submit (kept for compatibility) */
export async function submitDraftOrder(venueId: string, orderId: string, uid?: string) {
  return OrdersRepo.submitDraftOrder(venueId, orderId, uid);
}

/**
 * Submit-or-hold policy kept intact. If no policy → finalize immediately.
 * If policy exists → mark as pending_merge (no submittedAt yet).
 *
 * NOTE: This logic is intentionally left in the legacy service for now, since
 * it may pull in UI-facing policy/config behavior. We can move it into OrdersRepo next.
 */
export async function submitOrHoldDraftOrder(
  venueId: string,
  orderId: string,
  supplierId: string | null | undefined,
  opts?: { defaultWindowHours?: number; uid?: string }
) {
  return OrdersRepo.submitOrHoldDraftOrder(venueId, orderId, supplierId, opts);
}
