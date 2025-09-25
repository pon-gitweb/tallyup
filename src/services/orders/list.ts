import { getApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, orderBy, limit as qlimit, getDocs
} from 'firebase/firestore';

export type ListOrdersOpts = {
  status?: string;            // 'draft' | 'submitted' | 'received' | 'cancelled'
  includeArchived?: boolean;  // default false
  supplierId?: string;        // optional
  limit?: number;             // default 200 in fallback
};

export async function listOrders(venueId: string, opts: ListOrdersOpts = {}) {
  const db = getFirestore(getApp());
  const col = collection(db, 'venues', venueId, 'orders');

  const serverConds: any[] = [];
  if (opts.status)     serverConds.push(where('status', '==', opts.status));
  if (opts.supplierId) serverConds.push(where('supplierId', '==', opts.supplierId));

  const lim = opts.limit && opts.limit > 0 ? opts.limit : 200;

  try {
    const q1 = query(col, ...serverConds, orderBy('updatedAt', 'desc'), qlimit(lim));
    const snap = await getDocs(q1);
    let items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    if (!opts.includeArchived) items = items.filter(x => x.archived !== true);
    return items;
  } catch (e: any) {
    console.warn('[Orders:listOrders] index for updatedAt DESC not present, falling back:', e?.code || e?.message);
  }

  try {
    const q2 = query(col, ...serverConds, qlimit(lim));
    const snap = await getDocs(q2);
    let items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    if (!opts.includeArchived) items = items.filter(x => x.archived !== true);
    return items;
  } catch (e: any) {
    console.warn('[Orders:listOrders] composite index still required, softest fallback:', e?.code || e?.message);
  }

  const q3 = query(col, qlimit(lim));
  const snap = await getDocs(q3);
  let items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  if (opts.status)     items = items.filter(x => x.status === opts.status);
  if (opts.supplierId) items = items.filter(x => x.supplierId === opts.supplierId);
  if (!opts.includeArchived) items = items.filter(x => x.archived !== true);
  return items;
}
