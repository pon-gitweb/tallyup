// @ts-nocheck
/**
 * Finalizers for CSV/PDF/MANUAL flows.
 * - Calls REST reconcile-invoice
 * - Saves reconciliation bundle id
 * - Marks order as received (atomic)
 */
import { getApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { reconcileInvoiceREST } from '../invoices/reconcile';
import { saveReconciliation } from '../invoices/reconciliationStore';

type Parsed = {
  invoice?: { source?: 'csv'|'pdf'|'manual'|string; storagePath?: string; poNumber?: string|null } | null;
  lines?: Array<{ code?:string; name:string; qty:number; unitPrice?:number }>;
  matchReport?: any;
  confidence?: number | null;
  warnings?: string[] | null;
};

async function finalizeReceiveCore(kind:'csv'|'pdf'|'manual', args: { venueId:string; orderId:string; parsed: Parsed }) {
  const { venueId, orderId, parsed } = args;
  const db = getFirestore(getApp());

  // 1) Reconcile on server (authoritative)
  const reconciled = await reconcileInvoiceREST(venueId, orderId, {
    invoice: {
      source: kind,
      storagePath: parsed?.invoice?.storagePath || '',
      poNumber: parsed?.invoice?.poNumber ?? null,
      confidence: parsed?.confidence ?? null,
      warnings: parsed?.warnings ?? []
    },
    lines: parsed?.lines || [],
    matchReport: parsed?.matchReport,
    confidence: parsed?.confidence ?? null,
    warnings: parsed?.warnings ?? []
  });

  if (!reconciled?.ok) {
    return { ok:false, error: reconciled?.error || 'reconcile failed' };
  }

  // 2) Persist reconciliation summary bundle (id used on order)
  const saved = await saveReconciliation(venueId, orderId, reconciled);

  // 3) Mark received
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'received',
    receivedAt: serverTimestamp(),
    lastReconciliationId: saved?.id || reconciled?.reconciliationId || null
  });

  return { ok:true, reconciliationId: saved?.id || reconciled?.reconciliationId || null };
}

export async function finalizeReceiveFromCsv(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('csv', args);
}
export async function finalizeReceiveFromPdf(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('pdf', args);
}
export async function finalizeReceiveFromManual(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('manual', args);
}
