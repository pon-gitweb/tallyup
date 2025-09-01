import { db } from './firebase';
import {
  collection,
  addDoc,
  writeBatch,
  doc,
  setDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  query,
  orderBy,
  where,
  DocumentReference,
} from 'firebase/firestore';
import { listProducts } from './products';

/** ===== Types kept minimal & stable for existing screens ===== */
export type OrderStatus = 'draft' | 'submitted' | 'received' | 'cancelled';

export type Order = {
  id: string;
  venueId: string;
  supplierId: string;
  status: OrderStatus;
  createdAt?: any;
  updatedAt?: any;
  notes?: string | null;
  deliveryDate?: string | null;
  total?: number | null;
};

export type OrderLine = {
  productId: string;
  name: string;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;
  sku?: string | null;
  unit?: string | null;
};

/** ===== Suggested Orders (in-memory) =====
 * Groups products by supplier and suggests qty = max(0, par - onHand).
 * If product has no clear supplier, it is skipped.
 * Prices are optional — shown when present.
 */
export async function buildSuggestedOrdersInMemory(venueId: string): Promise<{
  bySupplier: Record<string, OrderLine[]>;
}> {
  if (!venueId) return { bySupplier: {} };

  const products = await listProducts(venueId);
  const bySupplier: Record<string, OrderLine[]> = {};

  for (const p of products as any[]) {
    const par = numOr(p?.par, 0);
    const onHand =
      numOr(p?.onHand, null) ??
      numOr(p?.stockOnHand, null) ??
      0;
    const needed = Math.max(0, par - onHand);
    if (!needed) continue;

    // Pick supplier: defaultSupplierId or cheapest from embedded prices map (if present)
    let supplierId: string | null = p?.defaultSupplierId || null;
    let priceUnitCost: number | null = null;
    let pricePackSize: number | null = null;

    if (!supplierId && p?.prices && typeof p.prices === 'object') {
      let cheapest: { supplierId: string; unitCost: number; packSize?: number | null } | null = null;
      for (const sid of Object.keys(p.prices)) {
        const pr = p.prices[sid];
        const uc = numOr(pr?.unitCost, null);
        if (uc == null) continue;
        if (!cheapest || uc < cheapest.unitCost) {
          cheapest = { supplierId: sid, unitCost: uc, packSize: numOr(pr?.packSize, null) };
        }
      }
      if (cheapest) {
        supplierId = cheapest.supplierId;
        priceUnitCost = cheapest.unitCost;
        pricePackSize = cheapest.packSize ?? null;
      }
    }

    if (!supplierId) continue; // can’t suggest without a supplier

    // If embedded price known for defaultSupplierId, pick it up
    if (p?.prices && p.prices[supplierId]) {
      priceUnitCost = numOr(p.prices[supplierId]?.unitCost, priceUnitCost);
      pricePackSize = numOr(p.prices[supplierId]?.packSize, pricePackSize);
    }

    const line: OrderLine = {
      productId: p.id || p.productId || p.sku || p.code || String(p.name || ''),
      name: String(p.name || p.sku || 'Unknown'),
      qty: needed,
      unitCost: priceUnitCost,
      packSize: pricePackSize,
      sku: p.sku ?? null,
      unit: p.unit ?? p.unitName ?? null,
    };

    if (!bySupplier[supplierId]) bySupplier[supplierId] = [];
    bySupplier[supplierId].push(line);
  }

  return { bySupplier };
}

/** ===== Create a draft order with lines ===== */
export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string,
  lines: OrderLine[],
  notes: string | null = null,
  deliveryDate?: string | null,
): Promise<{ orderId: string }> {
  if (!venueId) throw new Error('missing venueId');
  if (!supplierId) throw new Error('missing supplierId');

  // Create order
  const ordersCol = collection(doc(db, 'venues', venueId), 'orders');
  const orderRef = await addDoc(ordersCol, {
    supplierId,
    status: 'draft' as OrderStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    notes: notes ?? null,
    deliveryDate: deliveryDate ?? null,
    total: null,
  });

  // Write lines
  const batch = writeBatch(db);
  for (const l of lines) {
    const lineRef = doc(collection(orderRef as DocumentReference, 'lines'));
    batch.set(lineRef, {
      productId: l.productId,
      name: l.name,
      qty: Number(l.qty) || 0,
      unitCost: l.unitCost ?? null,
      packSize: l.packSize ?? null,
      sku: l.sku ?? null,
      unit: l.unit ?? null,
      createdAt: serverTimestamp(),
    });
  }
  batch.update(orderRef, { updatedAt: serverTimestamp() });
  await batch.commit();

  return { orderId: orderRef.id };
}

/** ===== Orders list / detail helpers (used by Orders screens) ===== */
export async function listOrders(venueId: string, status?: OrderStatus): Promise<Order[]> {
  if (!venueId) return [];
  let q = query(collection(doc(db, 'venues', venueId), 'orders'), orderBy('createdAt', 'desc'));
  if (status) {
    q = query(collection(doc(db, 'venues', venueId), 'orders'), where('status', '==', status), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, venueId, ...(d.data() as any) })) as Order[];
}

export async function getOrder(venueId: string, orderId: string): Promise<Order | null> {
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  const s = await getDoc(ref);
  return s.exists() ? ({ id: s.id, venueId, ...(s.data() as any) } as Order) : null;
}

export async function listOrderLines(venueId: string, orderId: string): Promise<OrderLine[]> {
  const ref = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
  const snap = await getDocs(ref);
  return snap.docs.map(d => d.data() as OrderLine);
}

export async function updateOrderStatus(venueId: string, orderId: string, status: OrderStatus) {
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, { status, updatedAt: serverTimestamp() });
}

export const submitOrder   = (v: string, o: string) => updateOrderStatus(v, o, 'submitted');
export const cancelOrder   = (v: string, o: string) => updateOrderStatus(v, o, 'cancelled');
export const markReceived  = (v: string, o: string) => updateOrderStatus(v, o, 'received');

/** ===== Utility ===== */
function numOr(v: any, fallback: number | null): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : fallback;
}

/**
 * Compute the total from an array of order lines.
 * Safe against missing/NaN values.
 */
export function calcTotal(
  lines: Array<{ unitCost?: number | null; qty?: number | null }>
): number {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, l) => {
    const price = Number(l?.unitCost ?? 0);
    const qty = Number(l?.qty ?? 0);
    if (!isFinite(price) || !isFinite(qty)) return sum;
    return sum + price * qty;
  }, 0);
}

/**
 * Fetch an order plus its lines for display in OrderDetailScreen.
 * Returns: { order: {...}, lines: Array<...> }
 */
export async function getOrderWithLines(venueId: string, orderId: string) {
  if (!venueId) throw new Error('Missing venueId');
  if (!orderId) throw new Error('Missing orderId');

  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  const osnap = await getDoc(oref);
  if (!osnap.exists()) throw new Error('Order not found');

  const order = { id: osnap.id, ...(osnap.data() as any) };

  const lref = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
  // Sort by name for a stable UI; change if you prefer createdAt
  const lq = query(lref, orderBy('name'));
  const lsnap = await getDocs(lq);
  const lines = lsnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  return { order, lines };
}

/** Update a single line's quantity (draft orders). */
export async function updateOrderLineQty(venueId: string, orderId: string, lineId: string, qty: number) {
  if (!venueId || !orderId || !lineId) throw new Error('Missing ids');
  const lref = doc(db, 'venues', venueId, 'orders', orderId, 'lines', lineId);
  await updateDoc(lref, { qty: Number(qty) || 0, updatedAt: serverTimestamp() });
}

/** Delete a line from a draft order. */
export async function deleteOrderLine(venueId: string, orderId: string, lineId: string) {
  if (!venueId || !orderId || !lineId) throw new Error('Missing ids');
  const lref = doc(db, 'venues', venueId, 'orders', orderId, 'lines', lineId);
  await deleteDoc(lref);
}

/** Update order note(s) on a draft order. */
export async function updateOrderNotes(venueId: string, orderId: string, notes: string) {
  if (!venueId || !orderId) throw new Error('Missing ids');
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(oref, { notes: notes ?? '', updatedAt: serverTimestamp() });
}

/** Submit a draft order (status -> submitted). */
async function submitOrder_DUPLICATE_DO_NOT_USE(venueId: string, orderId: string) {
  if (!venueId || !orderId) throw new Error('Missing ids');
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(oref, { status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

// --- receive: mark submitted -> received (does not alter stock levels yet) ---
export async function receiveOrder(venueId: string, orderId: string) {
  if (!venueId || !orderId) throw new Error('Missing ids');
  const oref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(oref, {
    status: 'received',
    receivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
