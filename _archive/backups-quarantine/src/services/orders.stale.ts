import { db } from './firebase';
import {
  collection, query, where, orderBy, getDocs, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';

export type TOrder = {
  id: string;
  status: 'draft'|'submitted'|'received'|'archived'|string;
  createdAt?: any;
  updatedAt?: any;
  snoozeUntil?: any | null;
};

function toMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

/** A draft is "stale" if updatedAt|createdAt is older than threshold days and not snoozed into the future. */
export function isDraftStale(order: TOrder, thresholdDays = 3, now = Date.now()): boolean {
  if (order.status !== 'draft') return false;
  const last = Math.max(toMillis(order.updatedAt), toMillis(order.createdAt));
  if (!last) return false;
  const snoozeMs = toMillis(order.snoozeUntil);
  if (snoozeMs && snoozeMs > now) return false; // snoozed
  const ageDays = (now - last) / (1000 * 60 * 60 * 24);
  return ageDays >= thresholdDays;
}

/** Load all draft orders (sorted newest first). */
export async function listDraftOrders(venueId: string): Promise<TOrder[]> {
  const q = query(
    collection(db, 'venues', venueId, 'orders'),
    where('status', '==', 'draft'),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  const out: TOrder[] = [];
  snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
  return out;
}

/** Mark a single order as archived. */
export async function archiveOrder(venueId: string, orderId: string): Promise<void> {
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(oref, {
    status: 'archived',
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Archive all stale drafts (returns count). */
export async function archiveStaleDrafts(venueId: string, thresholdDays = 3): Promise<number> {
  const drafts = await listDraftOrders(venueId);
  const stale = drafts.filter(d => isDraftStale(d, thresholdDays));
  for (const d of stale) {
    await archiveOrder(venueId, d.id);
  }
  return stale.length;
}

/** Snooze a draft until a given date (YYYY-MM-DD) or a millisecond epoch. */
export async function snoozeDraft(venueId: string, orderId: string, until: string | number): Promise<void> {
  const whenMs = typeof until === 'number' ? until : Date.parse(until);
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(oref, {
    snoozeUntil: whenMs,
    updatedAt: serverTimestamp(),
  });
}
