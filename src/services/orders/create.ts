import { getApp } from 'firebase/app';
import { getFirestore, collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';

export type DraftOrderLineInput = {
  productId: string;
  productName?: string | null;
  qty?: number;     // safe defaulting
  cost?: number;    // safe defaulting
};

export type CreateDraftOrderInput = {
  supplierId?: string | null;   // may be null for new drafts
  supplierName?: string | null;
  notes?: string | null;
  lines?: DraftOrderLineInput[]; // optional to avoid reduce-of-undefined
};

export async function createDraftOrderWithLines(
  venueId: string,
  uid: string | undefined,
  input: CreateDraftOrderInput
): Promise<{ orderId: string }> {
  const db = getFirestore(getApp());

  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const orderRef = doc(ordersCol);
  const linesCol = collection(db, 'venues', venueId, 'orders', orderRef.id, 'lines');

  const batch = writeBatch(db);

  const safeLines = Array.isArray(input.lines) ? input.lines : [];
  const subtotal = safeLines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.cost ?? 0), 0);

  // NEVER write undefined — coerce to null or sensible defaults
  batch.set(orderRef, {
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    notes: input.notes ?? null,
    status: 'draft',
    suggested: false,
    archived: false,
    totals: { subtotal },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid ?? null,
    updatedBy: uid ?? null,
  });

  for (const l of safeLines) {
    const lineRef = doc(linesCol);
    batch.set(lineRef, {
      productId: l.productId,                         // required by us
      productName: l.productName ?? null,
      qty: Number(l.qty ?? 0),
      cost: Number(l.cost ?? 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return { orderId: orderRef.id };
}
