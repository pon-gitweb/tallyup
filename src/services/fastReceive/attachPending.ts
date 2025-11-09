// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { finalizeReceiveFromCsv, finalizeReceiveFromPdf } from '../orders/receive';

/**
 * Attach a previously saved fast-receive snapshot to a submitted order
 * and run the same reconciliation tunnel as CSV/PDF flows.
 *
 * On success:
 *  - updates fastReceives/{fastId}.status = 'reconciled'
 *  - sets lastOrderId + reconciledAt
 */
export async function attachPendingFastReceive(args: {
  venueId: string;
  fastId: string;
  orderId: string;
}) {
  const { venueId, fastId, orderId } = args;
  const db = getFirestore(getApp());

  // Load the pending snapshot
  const snapRef = doc(db, 'venues', venueId, 'fastReceives', fastId);
  const snap = await getDoc(snapRef);
  if (!snap.exists()) return { ok:false, error:'Fast receive not found' };

  const data:any = snap.data() || {};
  if (data.status !== 'pending') return { ok:false, error:`Unexpected status ${data.status}` };

  // payload is the normalized parse envelope we saved earlier
  const source = (data?.source === 'csv') ? 'csv' : 'pdf';
  const storagePath = String(data?.storagePath || data?.payload?.invoice?.storagePath || '');
  const parsedPo = (data?.parsedPo ?? data?.payload?.invoice?.poNumber ?? null);

  const payload = {
    invoice: { source, storagePath, poNumber: parsedPo || null },
    lines: Array.isArray(data?.payload?.lines) ? data.payload.lines : [],
    confidence: (typeof data?.payload?.confidence === 'number') ? data.payload.confidence : null,
    warnings: Array.isArray(data?.payload?.warnings) ? data.payload.warnings : [],
  };

  // Reconcile via trusted tunnels
  const res = source === 'csv'
    ? await finalizeReceiveFromCsv({ venueId, orderId, parsed: payload })
    : await finalizeReceiveFromPdf({ venueId, orderId, parsed: payload });

  if (!res?.ok) {
    return { ok:false, error: res?.error || 'Reconciliation failed' };
  }

  // Mark the fast receive as reconciled
  await updateDoc(snapRef, {
    status: 'reconciled',
    lastOrderId: orderId,
    reconciledAt: serverTimestamp(),
  });

  return { ok:true, orderId, reconciliationId: res?.reconciliationId || null };
}
