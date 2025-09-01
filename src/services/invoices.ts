import { db } from './firebase';
import {
  doc, collection, addDoc, getDoc, getDocs, setDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';

type OrderLine = {
  productId: string;
  name: string;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;
};

export type Invoice = {
  id?: string;
  venueId: string;
  supplierId: string;
  orderId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null; // ISO string yyyy-mm-dd
  notes?: string | null;
  lines: OrderLine[];
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  createdAt?: any;
  receivedAt?: any;
  updatedAt?: any;
};

export async function createInvoiceFromOrder(params: {
  venueId: string;
  orderId: string;
  supplierId: string;
  lines: OrderLine[];
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  notes?: string | null;
}): Promise<{ invoiceId: string }> {
  const { venueId, orderId, supplierId, lines, invoiceNumber, invoiceDate, notes } = params;
  if (!venueId || !orderId || !supplierId) throw new Error('Missing ids');

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) * Number(l.unitCost ?? 0)), 0);
  const tax = 0; // simple for now
  const total = subtotal + tax;

  const invCol = collection(db, 'venues', venueId, 'invoices');
  const added = await addDoc(invCol, {
    venueId, supplierId, orderId,
    invoiceNumber: invoiceNumber ?? null,
    invoiceDate: invoiceDate ?? null,
    notes: notes ?? null,
    lines,
    subtotal, tax, total,
    createdAt: serverTimestamp(),
    receivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as Invoice);

  return { invoiceId: added.id };
}
