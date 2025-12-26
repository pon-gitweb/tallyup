import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, getDocs, getDoc, doc,
  query, where, orderBy, limit
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggestTypes';

export type OrderLine = {
  productId: string;
  productName?: string | null;
  qty: number;
  cost?: number | null;
};

export type Order = {
  id?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status: 'draft' | 'submitted' | 'received' | 'invoiced' | string;
  source?: 'manual' | 'suggestions' | string;
  createdAt?: any;
  createdBy?: string | null;
  lines: OrderLine[];
  total?: number;
};

export type CreateDraftsResult = {
  created: Array<{ orderId: string; supplierId: string | 'unassigned'; lineCount: number }>;
  skippedByGuard?: boolean;
};

const lineOK = (l: SuggestedLine) => l && Number(l.qty) > 0 && !!l.supplierId;

export function calcTotal(o: Order): number {
  return (o.lines ?? []).reduce((s, l) => s + (Number(l.cost ?? 0) * Number(l.qty ?? 0)), 0);
}

export async function getOrderWithLines(venueId: string, orderId: string): Promise<Order | null> {
  const db = getFirestore(getApp());
  const snap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
  if (!snap.exists()) return null;
  const o = snap.data() as any;
  return { id: snap.id, ...(o as Order), lines: Array.isArray(o?.lines) ? o.lines : [] };
}

export async function listOrders(venueId: string, opts: { status?: string } = {}): Promise<Order[]> {
  const db = getFirestore(getApp());
  let qref: any = collection(db, 'venues', venueId, 'orders');
  const parts: any[] = [];
  if (opts.status) parts.push(where('status', '==', opts.status));
  parts.push(orderBy('createdAt', 'desc'));
  if (parts.length) qref = query(qref, ...parts);
  const snap = await getDocs(qref);
  const out: Order[] = [];
  snap.forEach(d => {
    const o = d.data() as any;
    out.push({ id: d.id, ...(o as Order), lines: Array.isArray(o?.lines) ? o.lines : [] });
  });
  return out;
}

export async function createDraftsFromSuggestions(
  venueId: string,
  data: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<CreateDraftsResult> {
  const db = getFirestore(getApp());

  // Guard: avoid creating multiple “suggestions” drafts within 6 hours
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const guardQ = query(
    collection(db, 'venues', venueId, 'orders'),
    where('source', '==', 'suggestions'),
    where('createdAt', '>', cutoff),
    orderBy('createdAt', 'desc'),
    limit(1)
  );
  const guardSnap = await getDocs(guardQ);
  if (!guardSnap.empty) return { created: [], skippedByGuard: true };

  // De-duplicate buckets that are the same object (alias keys -> same lines)
  const uniq = new Map<any, SuggestedLine[]>();
  for (const k of Object.keys(data)) {
    const b: any = (data as any)[k];
    if (!b || !Array.isArray(b.lines) || b.lines.length === 0) continue;
    if (!uniq.has(b)) uniq.set(b, b.lines as SuggestedLine[]);
  }

  const created: Array<{ orderId: string; supplierId: string | 'unassigned'; lineCount: number }> = [];

  for (const [bucket, lines] of uniq) {
    const filtered = lines.filter(lineOK);
    if (filtered.length === 0) continue;

    const key = (bucket as any).supplierId ?? 'unassigned';
    const supplierId =
      ['unassigned', '__no_supplier__', 'no_supplier', 'none', 'null', 'undefined', ''].includes(String(key))
        ? 'unassigned'
        : String(key);

    const order = {
      supplierId,
      status: 'draft',
      source: 'suggestions',
      createdAt: new Date(),
      createdBy: opts.createdBy ?? null,
      lines: filtered.map(l => ({
        productId: l.productId,
        productName: l.productName ?? null,
        qty: l.qty,
        unitCost: l.unitCost ?? null,
      })),
    } as Order;
    order.total = calcTotal(order);

    const ref = await addDoc(collection(db, 'venues', venueId, 'orders'), order);
    created.push({ orderId: ref.id, supplierId, lineCount: filtered.length });
  }

  return { created };
}
