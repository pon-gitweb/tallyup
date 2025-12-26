import * as O from './orders';
import { toAppError, logError } from '../utils/errors';

// Re-export types you need
export type OrderLine = O.OrderLine;

// Wrap a few hot paths with friendly errors
export async function createDraftOrderWithLines(venueId: string, supplierId: string, lines: O.OrderLine[], notes?: string | null) {
  try {
    return await O.createDraftOrderWithLines(venueId, supplierId, lines, notes);
  } catch (e) {
    logError(e, 'orders.safe.createDraft', { venueId, supplierId, count: lines?.length ?? 0 });
    throw toAppError(e, { where: 'orders.safe.createDraft', venueId, supplierId });
  }
}

export async function getOrderWithLines(venueId: string, orderId: string) {
  try {
    return await O.getOrderWithLines(venueId, orderId);
  } catch (e) {
    logError(e, 'orders.safe.getOrderWithLines', { venueId, orderId });
    throw toAppError(e, { where: 'orders.safe.getOrderWithLines', venueId, orderId });
  }
}

export function calcTotal(lines: { qty?: number; unitCost?: number | null }[]): number {
  try {
    return O.calcTotal(lines);
  } catch (e) {
    logError(e, 'orders.safe.calcTotal');
    return 0;
  }
}

// Pass-through the rest of the API unchanged
export const updateOrderLineQty = O.updateOrderLineQty;
export const deleteOrderLine = O.deleteOrderLine;
export const updateOrderNotes = O.updateOrderNotes;
export const receiveOrder = O.receiveOrder;
export const submitOrder = O.submitOrder;
export const listDraftOrders = (O as any).listDraftOrders || undefined;
export const buildSuggestedOrdersInMemory = (O as any).buildSuggestedOrdersInMemory || undefined;
