import {
  collection, doc, serverTimestamp, Timestamp, writeBatch,
  getFirestore, getDoc, setDoc
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

// ✅ Type expected by NewOrderScreen
export type OrderLine = {
  productId: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
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

  // ✅ Correct modular Firestore usage
  const venueOrdersCol = collection(db, 'venues', venueId, 'orders');
  const orderRef = doc(venueOrdersCol);

  const batch = writeBatch(db);
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

/**
 * Minimal wrapper used by NewOrderScreen:
 *   createDraftOrderWithLines(venueId, supplierId, lines, note)
 * - looks up supplier name (if possible),
 * - reuses createDraftForSupplier(),
 * - writes note (merge) if provided.
 */
export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string,
  lines: OrderLine[],
  note: string | null
): Promise<string> {
  const db = getFirestore();

  // Try to resolve supplier name; fallback to supplierId
  let supplierName = supplierId;
  try {
    const supRef = doc(db, 'venues', venueId, 'suppliers', supplierId);
    const supSnap = await getDoc(supRef);
    if (supSnap.exists()) {
      const data = supSnap.data() as any;
      supplierName = String(data?.name ?? data?.supplierName ?? supplierId);
    }
  } catch {
    // non-fatal
  }

  const draftLines: DraftLine[] = lines.map(l => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku ?? null,
    qty: Number(l.qty || 0),
    unitCost: l.unitCost ?? null,
    packSize: l.packSize ?? null,
  }));

  const orderId = await createDraftForSupplier(db, venueId, supplierId, supplierName, null, draftLines);

  if (note && note.trim()) {
    await setDoc(
      doc(db, 'venues', venueId, 'orders', orderId),
      { note: note.trim(), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  return orderId;
}

export { buildSuggestedOrdersInMemory } from './orders/suggest';

export { listSuppliers } from './suppliers';
