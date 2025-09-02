import { doc, getDoc, collection, query, where, getDocs, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
const db = getFirestore(getApp());

export type OrderLine = {
  id: string;
  productId: string;
  productName?: string;
  qty: number;
  cost: number; // unit cost (excl GST)
};

export type Order = {
  id: string;
  supplierId?: string;
  supplierName?: string;
  status: 'draft'|'submitted'|'received'|'cancelled';
  notes?: string;
};

export type InvoiceLineInput = {
  lineId: string; // order line id (for matching)
  productId: string;
  productName?: string;
  qty: number;
  cost: number; // unit cost (excl GST)
};

export type InvoiceInput = {
  orderId: string;
  invoiceNumber: string;
  invoiceDateISO: string; // YYYY-MM-DD
  lines: InvoiceLineInput[];
};

export async function fetchOrderWithLines(venueId: string, orderId: string): Promise<{order: Order, lines: OrderLine[]}> {
  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error('Order not found');

  const orderData = orderSnap.data() as any;
  const order: Order = {
    id: orderSnap.id,
    supplierId: orderData.supplierId,
    supplierName: orderData.supplierName,
    status: orderData.status,
    notes: orderData.notes,
  };

  const linesRef = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
  const linesSnap = await getDocs(linesRef);
  const lines: OrderLine[] = linesSnap.docs.map(d => {
    const x = d.data() as any;
    return {
      id: d.id,
      productId: x.productId,
      productName: x.productName,
      qty: Number(x.qty || 0),
      cost: Number(x.cost || 0),
    };
  });

  return { order, lines };
}

export async function findInvoiceByOrder(venueId: string, orderId: string) {
  const q = query(collection(db, 'venues', venueId, 'invoices'), where('orderId', '==', orderId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

function computeVariance(orderLines: OrderLine[], invoiceLines: InvoiceLineInput[]) {
  const index = new Map(orderLines.map(l => [l.id, l]));
  let varianceValue = 0;
  const items: Array<{
    lineId: string;
    productId: string;
    diffQty: number; // invoice - order
    diffValue: number; // (invoiceQty * invoiceCost) - (orderQty * orderCost)
  }> = [];

  for (const inv of invoiceLines) {
    const ord = index.get(inv.lineId);
    if (!ord) continue;
    const orderValue = (Number(ord.qty) || 0) * (Number(ord.cost) || 0);
    const invoiceValue = (Number(inv.qty) || 0) * (Number(inv.cost) || 0);
    const diffValue = invoiceValue - orderValue;
    const diffQty = (Number(inv.qty) || 0) - (Number(ord.qty) || 0);
    varianceValue += diffValue;
    if (diffQty !== 0 || Math.abs(diffValue) > 0.0001) {
      items.push({
        lineId: ord.id,
        productId: ord.productId,
        diffQty,
        diffValue,
      });
    }
  }

  return { varianceValue, items };
}

/**
 * Writes invoices/{invoiceId} and invoices/{invoiceId}/lines/* via batch.
 * If an invoice for this order already exists, it overwrites it (idempotent).
 */
export async function upsertInvoiceFromOrder(venueId: string, uid: string, input: InvoiceInput) {
  const { order, lines: orderLines } = await fetchOrderWithLines(venueId, input.orderId);

  const invoiceDate = Timestamp.fromDate(new Date(input.invoiceDateISO + 'T00:00:00'));
  const variance = computeVariance(orderLines, input.lines);

  // Reuse existing invoice (if any) so users can re-post safely.
  const existing = await findInvoiceByOrder(venueId, input.orderId);

  const invoicesCol = collection(db, 'venues', venueId, 'invoices');
  const invoiceId = existing?.id || doc(invoicesCol).id;

  const invoiceRef = doc(db, 'venues', venueId, 'invoices', invoiceId);
  const batch = writeBatch(db);

  // Totals from invoice lines
  const subtotal = input.lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.cost || 0), 0);

  batch.set(invoiceRef, {
    orderId: input.orderId,
    supplierId: order.supplierId || null,
    supplierName: order.supplierName || null,
    number: input.invoiceNumber.trim(),
    date: invoiceDate,
    status: 'posted',
    totals: { subtotal },
    variance,          // { varianceValue, items[] }
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: existing?.createdBy || uid,
    updatedBy: uid,
  }, { merge: true });

  // Replace all invoice lines (simple, robust)
  const invLinesCol = collection(db, 'venues', venueId, 'invoices', invoiceId, 'lines');
  // There is no batch delete in Firestore; overwriting by setting with deterministic ids:
  for (const l of input.lines) {
    const lref = doc(invLinesCol, l.lineId); // keep linkage to order line
    batch.set(lref, {
      productId: l.productId,
      productName: l.productName || null,
      qty: Number(l.qty || 0),
      cost: Number(l.cost || 0),
    });
  }

  await batch.commit();
  return { invoiceId };
}
