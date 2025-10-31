import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp, writeBatch, doc,
  getDocs, orderBy, query, updateDoc
} from 'firebase/firestore';

export type Order = {
  id: string;
  status: 'draft'|'submitted'|'received'|'cancelled';
  supplierId: string|null;
  createdAt?: any;
  submittedAt?: any;
  receivedAt?: any;
};

export async function listOrders(venueId: string): Promise<Order[]> {
  const db = getFirestore(getApp());
  const q = query(collection(db, 'venues', venueId, 'orders'), orderBy('createdAt','desc'));
  const snap = await getDocs(q);
  const out: Order[] = [];
  snap.forEach(d => {
    const v:any = d.data() || {};
    out.push({
      id: d.id,
      status: (v.status ?? 'draft'),
      supplierId: v.supplierId ?? null,
      createdAt: v.createdAt ?? null,
      submittedAt: v.submittedAt ?? null,
      receivedAt: v.receivedAt ?? null,
    });
  });
  return out;
}

type NewLine = { productId: string; name?: string|null; qty: number; unitCost?: number|null };

export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string|null,
  lines: NewLine[],
  opts: { createdBy?: string|null } = {}
): Promise<{ orderId: string }> {
  const db = getFirestore(getApp());
  const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
    status: 'draft',
    supplierId: supplierId ?? null,
    createdAt: serverTimestamp(),
    createdBy: opts.createdBy ?? null,
    source: 'manual',
    needsSupplierReview: supplierId ? false : true,
  });
  const batch = writeBatch(db);
  for (const l of lines) {
    const pid = String(l.productId);
    const qty = Number(l.qty) || 0;
    const name = l.name ?? null;
    const unitCost = Number.isFinite(l.unitCost as any) ? Number(l.unitCost) : 0;
    batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', pid), {
      productId: pid, name, qty, unitCost
    });
  }
  await batch.commit();
  return { orderId: orderRef.id };
}

export async function submitDraftOrder(venueId: string, orderId: string, uid?: string|null) {
  const db = getFirestore(getApp());
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'submitted',
    submittedAt: serverTimestamp(),
    submittedBy: uid ?? null,
  });
}

export async function markOrderReceived(venueId: string, orderId: string, uid?: string|null) {
  const db = getFirestore(getApp());
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'received',
    receivedAt: serverTimestamp(),
    receivedBy: uid ?? null,
  });
}
