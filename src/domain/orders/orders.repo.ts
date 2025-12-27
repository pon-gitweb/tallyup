// Domain "repo" layer: owns persistence / Firestore details.
// Keep functions small + testable; services/screens should call via OrdersService/OrdersRepo.

import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';

export type SubmittedOrderLite = {
  id: string;
  poNumber?: string | null;
  supplierName?: string | null;
  createdAt?: any;
};

export const OrdersRepo = {
  async listSubmittedOrders(venueId: string, max: number = 100): Promise<SubmittedOrderLite[]> {
    if (!venueId) return [];
    const db = getFirestore(getApp());
    const q = query(
      collection(db, 'venues', venueId, 'orders'),
      where('status', '==', 'submitted'),
      orderBy('createdAt', 'desc'),
      limit(Math.max(1, Math.min(500, max)))
    );
    const snap = await getDocs(q);
    const out: SubmittedOrderLite[] = [];
    snap.forEach(d => {
      const x: any = d.data() || {};
      out.push({
        id: d.id,
        poNumber: x.poNumber ?? null,
        supplierName: x.supplierName ?? x.supplier ?? null,
        createdAt: x.createdAt ?? null,
      });
    });
    return out;
  },

  /**
   * Delete an order draft and all its lines. If this was the last draft
   * for that supplier, clear the corresponding lock:
   *   /venues/{v}/orderLocks/{supplierId | __UNASSIGNED__}
   */
  async deleteDraft(venueId: string, orderId: string): Promise<void> {
    if (!venueId || !orderId) return;
    const db = getFirestore(getApp());
    const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) return;

    const v: any = snap.data() || {};
    const supplierId: string | null = v?.supplierId ?? null;

    // 1) Delete all lines + order (batched)
    const linesCol = collection(orderRef, 'lines');
    const lineSnap = await getDocs(linesCol);
    const batch = writeBatch(db);
    lineSnap.forEach(d => batch.delete(doc(orderRef, 'lines', d.id)));
    batch.delete(orderRef);
    await batch.commit();

    // 2) If no other drafts for this supplier remain, remove lock
    const ordersCol = collection(db, 'venues', venueId, 'orders');
    const qRef =
      supplierId != null
        ? query(ordersCol, where('status', '==', 'draft'), where('supplierId', '==', String(supplierId)))
        : query(ordersCol, where('status', '==', 'draft'), where('supplierId', '==', null));

    const remaining = await getDocs(qRef);

    if (remaining.empty) {
      const lockKey = supplierId ?? '__UNASSIGNED__';
      const lockRef = doc(db, 'venues', venueId, 'orderLocks', String(lockKey));
      try {
        await deleteDoc(lockRef);
      } catch {}
    }
  },
};
