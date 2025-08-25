import { db } from './firebase';
import {
  addDoc, collection, doc, getDoc, getDocs, serverTimestamp, updateDoc, query, orderBy, where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { listProducts } from './products';
import { listSuppliers, Supplier } from './suppliers';

export type Order = {
  id?: string;
  supplierId: string;
  status: 'draft'|'submitted'|'received'|'cancelled';
  createdBy: string;
  createdAt?: any;
  submittedAt?: any;
  receivedAt?: any;
  notes?: string | null;
};

export type OrderLine = {
  id?: string;
  productId: string;
  name: string;
  qty: number;
  unitCost: number|null;
  packSize?: number|null;
};

// ---------- Suggestion logic (MVP) ----------

async function getOnHandByProduct(_venueId: string): Promise<Record<string, number>> {
  // TODO: wire into real inventory counts later.
  return {};
}

export async function buildSuggestedOrdersInMemory(venueId: string): Promise<{
  suppliers: Record<string, Supplier>;
  bySupplier: Record<string, OrderLine[]>;
}> {
  const [products, suppliersArr, onHandMap] = await Promise.all([
    listProducts(venueId),
    listSuppliers(venueId),
    getOnHandByProduct(venueId),
  ]);
  const suppliers: Record<string, Supplier> = {};
  suppliersArr.forEach(s => { if (s.id) suppliers[s.id] = s; });

  const bySupplier: Record<string, OrderLine[]> = {};

  for (const p of products) {
    if (!p.defaultSupplierId || p.parLevel == null) continue;
    const onHand = onHandMap[p.id || ''] || 0;
    const needed = Math.max(0, Number(p.parLevel) - Number(onHand));
    if (needed <= 0) continue;

    const sId = p.defaultSupplierId;
    if (!bySupplier[sId]) bySupplier[sId] = [];
    bySupplier[sId].push({
      productId: p.id!,
      name: p.name,
      qty: needed,
      unitCost: p.cost ?? null,
      packSize: p.packSize ?? null,
    });
  }

  Object.keys(bySupplier).forEach(sid => {
    bySupplier[sid].sort((a, b) => a.name.localeCompare(b.name));
  });

  return { suppliers, bySupplier };
}

// ---------- Firestore writers & readers ----------

export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string,
  lines: OrderLine[],
  notes?: string | null
): Promise<string> {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');

  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const orderRef = await addDoc(ordersCol, {
    supplierId,
    status: 'draft',
    createdBy: uid,
    createdAt: serverTimestamp(),
    notes: notes ?? null,
  } as Order);

  for (const line of lines) {
    await addDoc(collection(db, 'venues', venueId, 'orders', orderRef.id, 'lines'), {
      productId: line.productId,
      name: line.name,
      qty: Number(line.qty) || 0,
      unitCost: line.unitCost ?? null,
      packSize: line.packSize ?? null,
    } as OrderLine);
  }

  return orderRef.id;
}

export async function submitOrder(venueId: string, orderId: string) {
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'submitted',
    submittedAt: serverTimestamp(),
  });
}

export async function markReceived(venueId: string, orderId: string) {
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'received',
    receivedAt: serverTimestamp(),
  });
}

export async function cancelOrder(venueId: string, orderId: string) {
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'cancelled',
  });
}

export async function getOrderWithLines(
  venueId: string,
  orderId: string
): Promise<{ order: Order & { id: string }, lines: (OrderLine & { id: string })[] }> {
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  const osnap = await getDoc(oref);
  if (!osnap.exists()) throw new Error('Order not found');
  const order = { id: osnap.id, ...(osnap.data() as any) } as Order & { id: string };

  const lcol = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
  const lsnap = await getDocs(lcol);
  const lines: (OrderLine & { id: string })[] = [];
  lsnap.forEach(d => lines.push({ id: d.id, ...(d.data() as any) }));
  return { order, lines };
}

export async function listOrders(
  venueId: string,
  status?: Order['status']
): Promise<(Order & { id: string })[]> {
  const col = collection(db, 'venues', venueId, 'orders');
  const q = status
    ? query(col, where('status', '==', status), orderBy('createdAt', 'desc'))
    : query(col, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const out: (Order & { id: string })[] = [];
  snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
  return out;
}

// ---------- Utils ----------

export function calcTotal(lines: Pick<OrderLine, 'qty'|'unitCost'>[]): number {
  return lines.reduce((sum, l) => {
    const price = l.unitCost != null ? Number(l.unitCost) : 0;
    const qty = Number(l.qty) || 0;
    return sum + price * qty;
  }, 0);
}
