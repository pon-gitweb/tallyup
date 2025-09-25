import {
  collection, doc, serverTimestamp, Timestamp, writeBatch,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

// ---- Draft expiry/reminder policy (client-side; safe defaults) ----
export const DRAFT_TTL_DAYS = 7;
export const DRAFT_REMINDER_HOURS = 24;

export function computeExpiresAt(now = new Date(), days = DRAFT_TTL_DAYS): Timestamp {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return Timestamp.fromDate(d);
}
export function computeReminderAt(now = new Date(), hours = DRAFT_REMINDER_HOURS): Timestamp {
  const d = new Date(now.getTime());
  d.setHours(d.getHours() + hours);
  return Timestamp.fromDate(d);
}

export type DraftLine = {
  productId: string;
  name: string;
  sku?: string | null;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;
};

function sum(a: number[]) { return a.reduce((x, y) => x + y, 0); }

/**
 * Create a single-supplier draft order at:
 *   venues/{venueId}/orders/{orderId}
 *   venues/{venueId}/orders/{orderId}/lines/{productId}
 */
export async function createDraftForSupplier(
  db: Firestore,
  venueId: string,
  supplierId: string,
  supplierName: string,
  deliveryDate: Date | null,
  lines: DraftLine[],
): Promise<string> {
  if (!venueId) throw new Error('Missing venueId');
  if (!supplierId) throw new Error('Missing supplierId');
  if (!lines?.length) throw new Error('No lines to draft');

  const now = new Date();
  const expiresAt = computeExpiresAt(now);
  const reminderAt = computeReminderAt(now);

  const subtotal = sum(lines.map(l => (l.unitCost ?? 0) * (l.qty ?? 0)));

  const ordersCol = collection(doc(collection({} as any, ''), 'venues', venueId), 'orders'); // dummy to satisfy TS
  // real refs:
  const venueOrdersCol = collection((doc({} as any, 'venues', venueId) as any).firestore, 'venues', venueId, 'orders');
  const orderRef = doc(venueOrdersCol);

  const batch = writeBatch((orderRef as any).firestore);
  batch.set(orderRef, {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    venueId,
    supplierId,
    supplierName,
    status: 'draft',
    deliveryDate: deliveryDate ? Timestamp.fromDate(deliveryDate) : null,
    subtotal,
    expiresAt,
    reminderAt,
    banner: 'Draft order (not sent)',
  });

  for (const l of lines) {
    const lineRef = doc(collection(orderRef, 'lines'), l.productId);
    batch.set(lineRef, {
      productId: l.productId,
      name: l.name,
      sku: l.sku ?? null,
      qty: l.qty,
      unitCost: l.unitCost ?? null,
      packSize: l.packSize ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return orderRef.id;
}
