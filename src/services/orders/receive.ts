// @ts-nocheck
/**
 * Minimal receive finalizers that:
 * 1) Re-run reconciliation (server or client side)
 * 2) Persist final reconciliation bundle
 * 3) Mark order as received
 *
 * NOTE: Keep surface area identical for CSV/PDF.
 */
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { saveReconciliation } from '../invoices/reconciliationStore';
import { reconcile } from '../invoices/reconciliation'; // your pure function (adjust import if needed)

type Parsed = {
  invoice?: { source?: 'csv'|'pdf'|string; storagePath?: string; poNumber?: string|null } | null;
  lines?: Array<{ code?:string; name:string; qty:number; unitPrice?:number }>;
  matchReport?: any;
  confidence?: number | null;
  warnings?: string[] | null;
};

async function finalizeReceiveCore(kind:'csv'|'pdf', args: { venueId:string; orderId:string; parsed: Parsed }) {
  const { venueId, orderId, parsed } = args;
  const db = getFirestore(getApp());

  // 1) Run reconciliation (client-side) — adjust if your flow is server-based
  const reconciliation = reconcile({
    venueId, orderId,
    invoice: { source: kind, storagePath: parsed?.invoice?.storagePath || '', poNumber: parsed?.invoice?.poNumber || null },
    lines: parsed?.lines || []
  });

  // 2) Persist reconciliation bundle
  const saved = await saveReconciliation(venueId, orderId, reconciliation);

  // 3) Mark order as received
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'received',
    receivedAt: serverTimestamp(),
    lastReconciliationId: saved.id
  });

  return { reconciliationId: saved.id, reconciliation };
}

export async function finalizeReceiveFromCsv(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('csv', args);
}

export async function finalizeReceiveFromPdf(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('pdf', args);
}
