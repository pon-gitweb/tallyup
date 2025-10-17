import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

export type DraftOrderLineInput = {
  productId: string;
  name: string;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;
};

async function resolveSupplierName(
  venueId: string,
  supplierId: string,
  supplierName?: string | null
): Promise<string | null> {
  if (typeof supplierName === 'string' && supplierName.trim().length > 0) return supplierName.trim();
  if (!venueId || !supplierId) return null;
  const sRef = doc(db, 'venues', venueId, 'suppliers', supplierId);
  const snap = await getDoc(sRef);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  const n = data?.name ? String(data.name) : null;
  return n && n.length > 0 ? n : null;
}

export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string,
  lines: DraftOrderLineInput[],
  notes?: string | null,
  supplierNameHint?: string | null
): Promise<{ id: string }> {
  if (!venueId) throw new Error('createDraftOrderWithLines: venueId required');
  if (!supplierId) throw new Error('createDraftOrderWithLines: supplierId required');

  const cleaned = (lines || [])
    .map((l) => ({
      productId: String(l?.productId ?? '').trim(),
      name: String(l?.name ?? ''),
      qty: Number.isFinite(l?.qty as number) ? Math.max(1, Math.round(Number(l.qty))) : 1,
      unitCost: Number.isFinite(l?.unitCost as number) ? Number(l.unitCost) : 0,
      packSize: Number.isFinite(l?.packSize as number) ? Number(l.packSize) : null,
    }))
    .filter((l) => l.productId && l.qty >= 1);

  if (cleaned.length === 0) throw new Error('No valid lines to create');

  const supplierName = await resolveSupplierName(venueId, supplierId, supplierNameHint);
  const itemsCount = cleaned.length;
  const subtotal = cleaned.reduce((acc, l) => acc + l.qty * (l.unitCost ?? 0), 0);

  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const orderRef = doc(ordersCol);
  const batch = writeBatch(db);
  const now = serverTimestamp();

  const header: Record<string, any> = {
    docType: 'order',
    state: 'draft',
    status: 'draft',
    displayStatus: 'Draft',
    isDraft: true,
    venueId,
    supplierId,
    supplierName: supplierName ?? null,
    supplier: { id: supplierId, name: supplierName ?? null },
    itemsCount,
    lineCount: itemsCount,
    totals: { subtotal },
    notes: notes ?? null,
    origin: 'suggested',
    source: 'suggestedOrders',
    createdAt: now,
    updatedAt: now,
  };

  batch.set(orderRef, header);

  const linesCol = collection(db, 'venues', venueId, 'orders', orderRef.id, 'lines');
  for (const l of cleaned) {
    const lineRef = doc(linesCol, l.productId); // stable by product
    const lineDoc: Record<string, any> = {
      productId: l.productId,
      name: l.name ?? '',
      qty: l.qty,
      unitCost: l.unitCost ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    if (l.packSize != null) lineDoc.packSize = l.packSize;
    batch.set(lineRef, lineDoc);
  }

  await batch.commit();
  return { id: orderRef.id };
}
