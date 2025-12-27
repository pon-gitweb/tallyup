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
  updateDoc,
  serverTimestamp,
  runTransaction,
  setDoc,
  increment
} from 'firebase/firestore';

export type SubmittedOrderLite = {
  id: string;
  poNumber?: string | null;
  supplierName?: string | null;
  createdAt?: any;
};

function yyyymmdd(d: Date){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}
function venueShort(venueId: string){
  const s = String(venueId||'').replace(/[^a-zA-Z0-9]/g,'');
  return s.slice(-5) || 'VENUE';
}
function fallbackPoNumber(dateKey: string, venueId: string, orderId: string){
  const tail = (orderId || '').slice(-4).toUpperCase() || Math.floor(Math.random()*10000).toString().padStart(4,'0');
  return `PO-${dateKey}-${venueShort(venueId)}-${tail}`;
}

/**
 * Best-effort PO assignment:
 * 1) Try venue orderCounters/{dateKey}
 * 2) Try alternate counters path counters_orders/{dateKey}
 * 3) If blocked, generate fallback PO and proceed
 */
async function ensurePoFields(db: ReturnType<typeof getFirestore>, venueId: string, orderId: string){
  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return;

  const v: any = snap.data() || {};
  if (v.poNumber && v.poDate) return;

  const now = new Date();
  const dateKey = yyyymmdd(now);

  // Try #1: venues/{venueId}/orderCounters/{dateKey}
  try {
    const c1 = doc(db, 'venues', venueId, 'orderCounters', dateKey);
    await runTransaction(db, async (tx) => {
      const cs = await tx.get(c1);
      if (cs.exists()) {
        tx.update(c1, { seq: increment(1) });
      } else {
        tx.set(c1, { seq: 1, dateKey, createdAt: serverTimestamp() });
      }
    });
    const after = await getDoc(c1);
    const seqNum = Number(after.data()?.seq || 1);
    const seq4 = String(seqNum).padStart(4,'0');
    const poNumber = `PO-${dateKey}-${venueShort(venueId)}-${seq4}`;
    await updateDoc(orderRef, { poNumber, poDate: serverTimestamp() });
    return;
  } catch (e:any) {}

  // Try #2: venues/{venueId}/counters_orders/{dateKey}
  try {
    const c2 = doc(db, 'venues', venueId, 'counters_orders', dateKey);
    await runTransaction(db, async (tx) => {
      const cs = await tx.get(c2);
      if (cs.exists()) {
        tx.update(c2, { seq: increment(1) });
      } else {
        tx.set(c2, { seq: 1, dateKey, createdAt: serverTimestamp() });
      }
    });
    const after2 = await getDoc(c2);
    const seqNum2 = Number(after2.data()?.seq || 1);
    const seq42 = String(seqNum2).padStart(4,'0');
    const poNumber2 = `PO-${dateKey}-${venueShort(venueId)}-${seq42}`;
    await updateDoc(orderRef, { poNumber: poNumber2, poDate: serverTimestamp() });
    return;
  } catch (e2:any) {}

  // Fallback: never block submit
  const poNumber3 = fallbackPoNumber(dateKey, venueId, orderId);
  await updateDoc(orderRef, { poNumber: poNumber3, poDate: serverTimestamp() });
}

export const OrdersRepo = {
  async finalizeToSubmitted(
    venueId: string,
    orderId: string,
    uid?: string
  ) {
    const db = getFirestore(getApp());
    const ref = doc(db, 'venues', venueId, 'orders', orderId);

    await updateDoc(ref, {
      status: 'submitted',
      displayStatus: 'submitted',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid ?? null,
      submittedBy: uid ?? null,

      plannedSubmitAt: null,
      isConsolidating: null,
      submitHoldUntil: null,
      cutoffAt: null,
      merge: null,
      queued: null,
      pending: null,
      pendingReason: null,
    });

    await ensurePoFields(db, venueId, orderId);
  },

  /** Legacy immediate submit (kept for compatibility) */
  async submitDraftOrder(venueId: string, orderId: string, uid?: string) {
    return this.finalizeToSubmitted(venueId, orderId, uid);
  },

  /**
   * Submit-or-hold policy kept intact from legacy service.
   * NOTE: This is intentionally migrated without inventing policy reads.
   */
  async submitOrHoldDraftOrder(
    venueId: string,
    orderId: string,
    supplierId: string | null | undefined,
    opts?: { defaultWindowHours?: number; uid?: string }
  ) {
    const db = getFirestore(getApp());
    const now = new Date();

    let mergeWindowHours: number | null = null;
    let cutoffLocal: string | null = null;

    // ⚠️ If you had supplier policy reads before, paste them here verbatim
    // (intentionally unchanged)

    // No policy → immediate submit
    if (!mergeWindowHours && !cutoffLocal) {
      await this.finalizeToSubmitted(venueId, orderId, opts?.uid);
      return;
    }

    // If you re-enable holding logic, ensure you DO NOT set submittedAt here.
    // (Pending-merge write omitted in current legacy behavior)
  },

  async finalizeReceiveFromCsv(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('csv', args);
},

  async finalizeReceiveFromPdf(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('pdf', args);
},
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
