// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  query,
  where,
  deleteDoc as fsDeleteDoc,
} from 'firebase/firestore';

/**
 * Delete an order draft and all its lines. If this was the last draft
 * for that supplier, clear the corresponding lock:
 *   /venues/{v}/orderLocks/{supplierId | __UNASSIGNED__}
 */
export async function deleteDraft(venueId: string, orderId: string): Promise<void> {
  if (!venueId || !orderId) return;
  const db = getFirestore(getApp());
  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) {
    // Nothing to do
    return;
  }
  const v: any = snap.data() || {};
  const supplierId: string | null = v?.supplierId ?? null;

  // 1) Delete all lines (batched)
  const linesCol = collection(orderRef, 'lines');
  const lineSnap = await getDocs(linesCol);
  const batch = writeBatch(db);
  lineSnap.forEach(d => batch.delete(doc(orderRef, 'lines', d.id)));
  batch.delete(orderRef);
  await batch.commit();

  // 2) If no other drafts for this supplier remain, remove lock
  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const qRef = supplierId != null
    ? query(ordersCol, where('status', '==', 'draft'), where('supplierId', '==', String(supplierId)))
    : query(ordersCol, where('status', '==', 'draft'), where('supplierId', '==', null));
  const remaining = await getDocs(qRef);

  if (remaining.empty) {
    const lockKey = supplierId ?? '__UNASSIGNED__';
    const lockRef = doc(db, 'venues', venueId, 'orderLocks', String(lockKey));
    // Best-effort delete (no throw if missing)
    try { await fsDeleteDoc(lockRef); } catch {}
  }
}
