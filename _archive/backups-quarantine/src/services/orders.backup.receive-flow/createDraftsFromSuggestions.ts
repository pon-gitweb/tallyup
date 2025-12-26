// @ts-nocheck
import { getFirestore, collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';

/**
 * Create a draft order for a single supplier from suggestion lines,
 * and write each line as a subcollection doc: /orders/{orderId}/lines/{productId}.
 *
 * Args:
 *   venueId: string
 *   params: {
 *     supplierId: string;
 *     supplierName?: string | null;
 *     suggestions: Array<{ productId: string; productName?: string; qty?: number; cost?: number; packSize?: number | null }>;
 *   }
 *
 * Returns: { id: string }
 */
export async function createDraftsFromSuggestions(
  venueId: string,
  params: { supplierId: string; supplierName?: string | null; suggestions: Array<any> }
): Promise<{ id: string }> {
  if (!venueId) throw new Error('createDraftsFromSuggestions: venueId required');
  const { supplierId, supplierName, suggestions } = params || {};
  if (!supplierId) throw new Error('createDraftsFromSuggestions: supplierId required');

  const db = getFirestore();
  const now = serverTimestamp();

  // 1) Create draft header (empty doc id via collection+doc)
  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const orderRef = doc(ordersCol);

  const cleaned = (Array.isArray(suggestions) ? suggestions : [])
    .map((raw) => {
      const productId = String(raw?.productId || '').trim();
      const name = String(raw?.productName || raw?.name || productId);
      const qty = Math.max(1, Math.round(Number(raw?.qty ?? 0)));
      const unitCost = Number(raw?.cost ?? raw?.unitCost ?? 0);
      const packSize = Number.isFinite(raw?.packSize) ? Number(raw?.packSize) : null;
      return { productId, name, qty, unitCost, packSize };
    })
    .filter((l) => l.productId && l.qty > 0);

  if (cleaned.length === 0) throw new Error('No valid suggestion lines to create');

  const header = {
    status: 'draft',
    displayStatus: 'Draft',
    source: 'suggestions',
    supplierId,
    supplierName: supplierName ?? null,
    createdAt: now,
    updatedAt: now,
    // Lightweight summary (optional)
    lineCount: cleaned.length,
    estSubtotal: cleaned.reduce((s, l) => s + (l.unitCost || 0) * l.qty, 0),
  };

  const batch = writeBatch(db);
  batch.set(orderRef, header);

  // 2) Subcollection lines keyed by productId
  for (const l of cleaned) {
    const lineRef = doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', l.productId);
    const lineDoc: Record<string, any> = {
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitCost: l.unitCost ?? 0,
      updatedAt: now,
    };
    if (l.packSize != null) lineDoc.packSize = l.packSize;
    batch.set(lineRef, lineDoc);
  }

  await batch.commit();
  return { id: orderRef.id };
}
