import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';

/** Sum helpers */
export function calcTotal(lines: Array<{ qty?: number; unitCost?: number }>): number {
  return (lines || []).reduce((sum, l) => {
    const q = Number(l?.qty ?? 0);
    const c = Number(l?.unitCost ?? 0);
    return sum + (Number.isFinite(q * c) ? q * c : 0);
  }, 0);
}

/** Load order + its lines as a simple shape the UI can render */
export async function getOrderWithLines(venueId: string, orderId: string): Promise<{
  orderId: string;
  header: any;
  lines: Array<{ id: string; qty: number; unitCost: number; name?: string | null; productId?: string | null }>;
}> {
  const db = getFirestore(getApp());
  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
  const headerSnap = await getDoc(orderRef);
  const header = headerSnap.exists() ? headerSnap.data() : {};

  const linesSnap = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
  const lines = linesSnap.docs.map((d) => {
    const v = d.data() as any;
    return {
      id: d.id,
      productId: v?.productId ?? null,
      name: v?.name ?? null,
      qty: Number(v?.qty ?? 0),
      unitCost: Number(v?.unitCost ?? 0),
    };
  });

  return { orderId, header, lines };
}

export async function submitDraftOrder(venueId: string, orderId: string, uid?: string | null) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    status: 'submitted',
    submittedAt: serverTimestamp(),
    submittedBy: uid ?? null,
  });
}

export async function receiveOrder(
  venueId: string,
  orderId: string,
  opts: { receivedTotal?: number | null; note?: string | null } = {},
  uid?: string | null
) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    status: 'received',
    receivedAt: serverTimestamp(),
    receivedBy: uid ?? null,
    receivedTotal: Number.isFinite(opts.receivedTotal as any) ? Number(opts.receivedTotal) : null,
    receivedNote: opts.note ?? null,
  });
}

export async function postInvoice(
  venueId: string,
  orderId: string,
  invoiceNumber: string,
  amount: number | null,
  uid?: string | null
) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    invoiceNumber: invoiceNumber || null,
    invoiceAmount: Number.isFinite(amount as any) ? Number(amount) : null,
    invoicedAt: serverTimestamp(),
    invoicedBy: uid ?? null,
  });
}

/** Safe listOrders used by OrdersScreen */
export async function listOrders(venueId: string): Promise<
  Array<{ id: string; status?: string; supplierId?: string | null; createdAt?: any }>
> {
  const db = getFirestore(getApp());
  const qy = query(collection(db, 'venues', venueId, 'orders'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => {
    const v = d.data() as any;
    return {
      id: d.id,
      status: v?.status,
      supplierId: v?.supplierId ?? null,
      createdAt: v?.createdAt ?? null,
    };
  });
}
