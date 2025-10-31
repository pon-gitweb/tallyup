import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit as qlimit,
  where,
  Timestamp,
} from 'firebase/firestore';

export type Supplier = { id: string; name?: string | null };

export type OrderLine = {
  productId: string;
  name?: string | null;
  qty: number;
  unitCost: number;
};

export type Order = {
  id: string;
  status: string;
  supplierId?: string | null;
  createdAt?: any;
  createdBy?: string | null;
  source?: string | null;
  [k: string]: any;
};

export async function listSuppliers(venueId: string): Promise<Supplier[]> {
  const db = getFirestore(getApp());
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  return snap.docs.map(d => {
    const v = d.data() as any;
    return { id: d.id, name: v?.name ?? null };
  });
}

export async function listOrders(venueId: string, opts?: { limit?: number }): Promise<Order[]> {
  const db = getFirestore(getApp());
  const q = query(
    collection(db, 'venues', venueId, 'orders'),
    orderBy('createdAt', 'desc'),
    qlimit(opts?.limit ?? 50)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function getOrderWithLines(
  venueId: string,
  orderId: string
): Promise<{ order: Order; lines: OrderLine[] }> {
  const db = getFirestore(getApp());
  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error('Order not found');

  const linesSnap = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
  const lines: OrderLine[] = linesSnap.docs.map(d => {
    const v = d.data() as any;
    return {
      productId: v?.productId ?? d.id,
      name: v?.name ?? null,
      qty: Number(v?.qty ?? 0),
      unitCost: Number(v?.unitCost ?? 0),
    };
  });

  return { order: { id: orderSnap.id, ...(orderSnap.data() as any) }, lines };
}

export function calcTotal(lines: OrderLine[]): number {
  return lines.reduce(
    (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0),
    0
  );
}

/** Helper: find a recent suggestions draft after a timestamp (guard against duplicates). */
export async function findSuggestionsDraftAfter(
  venueId: string,
  since: Date
): Promise<boolean> {
  const db = getFirestore(getApp());
  // Firestore can't compare on two fields easily; we do two queries and OR them.
  const cutoff = Timestamp.fromDate(since);
  const base = collection(db, 'venues', venueId, 'orders');

  // first: source == 'suggestions' AND createdAt >= cutoff
  const q1 = query(base, where('source', '==', 'suggestions'), where('createdAt', '>=', cutoff));
  const s1 = await getDocs(q1);
  if (!s1.empty) return true;

  // fallback: status == 'draft' AND createdAt >= cutoff (some older data might be missing source)
  const q2 = query(base, where('status', '==', 'draft'), where('createdAt', '>=', cutoff));
  const s2 = await getDocs(q2);
  return !s2.empty;
}

/** Best-effort: try to read last stocktake time; fallback to a fixed window. */
export async function getLastStocktakeTimeOrWindowStart(
  venueId: string,
  windowHours = 6
): Promise<Date> {
  const db = getFirestore(getApp());
  try {
    // try a plausible sessions collection; ignore if not present
    const q = query(
      collection(db, 'venues', venueId, 'inventorySessions'),
      orderBy('startedAt', 'desc'),
      qlimit(1)
    );
    const s = await getDocs(q);
    if (!s.empty) {
      const v = s.docs[0].data() as any;
      const d = v?.completedAt?.toDate?.() ?? v?.startedAt?.toDate?.();
      if (d instanceof Date) return d;
    }
  } catch {
    // ignore
  }
  // fallback: a time window
  const d = new Date();
  d.setHours(d.getHours() - windowHours);
  return d;
}
