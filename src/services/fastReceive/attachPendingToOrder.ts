// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { finalizeReceiveFromCsv, finalizeReceiveFromPdf } from '../orders/receive';

/**
 * Attach a pending fast-receive snapshot to a chosen Submitted Order.
 * - Reads venues/{venueId}/fastReceives/{pendingId}
 * - Uses its payload to run the same finalize receive tunnel (csv/pdf)
 * - Marks the snapshot { status:'attached', attachedOrderId, attachedAt }
 *
 * Returns { ok, reconciled?: boolean, error? }
 */
export async function attachPendingToOrder(args: {
  venueId: string;
  pendingId: string;
  orderId: string;
}) {
  const { venueId, pendingId, orderId } = args;
  if (!venueId) return { ok: false, error: 'venueId required' };
  if (!pendingId) return { ok: false, error: 'pendingId required' };
  if (!orderId) return { ok: false, error: 'orderId required' };

  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'fastReceives', pendingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, error: 'Snapshot not found' };

  // Shape written by persistFastReceiveSnapshot / tryAttachToOrderOrSavePending
  const data: any = snap.data() || {};
  const payload = data?.payload || null;

  if (!payload || !payload.invoice || !Array.isArray(payload.lines)) {
    return { ok: false, error: 'Invalid snapshot payload' };
  }

  const source = (payload?.invoice?.source || data?.source || 'unknown').toLowerCase();
  const parsed = {
    invoice: {
      source: source === 'csv' ? 'csv' : 'pdf',
      storagePath: payload?.invoice?.storagePath || data?.storagePath || '',
      poNumber: payload?.invoice?.poNumber ?? data?.parsedPo ?? null,
    },
    lines: payload?.lines || [],
    confidence: payload?.confidence ?? null,
    warnings: payload?.warnings ?? [],
  };

  const result = parsed.invoice.source === 'csv'
    ? await finalizeReceiveFromCsv({ venueId, orderId, parsed })
    : await finalizeReceiveFromPdf({ venueId, orderId, parsed });

  if (!result?.ok) {
    return { ok: false, error: result?.error || 'finalize receive failed' };
  }

  // Mark as attached (non-destructive; we keep payload for audit)
  await updateDoc(ref, {
    status: 'attached',
    attachedOrderId: orderId,
    attachedAt: serverTimestamp(),
    // keep storagePath, payload, parsedPo as-is
  });

  return { ok: true, reconciled: !!result?.ok };
}

export default attachPendingToOrder;
