// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, limit, getDocs, addDoc, serverTimestamp
} from 'firebase/firestore';
import { finalizeReceiveFromCsv, finalizeReceiveFromPdf } from '../orders/receive';

type Parsed = {
  invoice?: { poNumber?: string|null; source?: 'csv'|'pdf'|'manual'|string; storagePath?: string } | null;
  lines?: Array<{ code?:string; name:string; qty:number; unitPrice?:number }>;
  confidence?: number | null;
  warnings?: string[] | null;
};

export async function tryAttachToOrderOrSavePending(args: {
  venueId: string;
  parsed: Parsed;
  storagePath: string;
}) {
  const { venueId, parsed, storagePath } = args;
  const db = getFirestore(getApp());

  // 1) Try find a submitted order with matching PO
  const po = (parsed?.invoice?.poNumber ?? '').trim();
  let orderId: string | null = null;

  if (po) {
    const q = query(
      collection(db, 'venues', venueId, 'orders'),
      where('poNumber', '==', po),
      where('status', '==', 'submitted'),
      limit(1)
    );
    const snap = await getDocs(q);
    snap.forEach(d => { orderId = d.id; });
  }

  // 2) If found: finalize using existing tunnels
  if (orderId) {
    const payload = {
      invoice: { source: parsed?.invoice?.source === 'csv' ? 'csv' : 'pdf', storagePath, poNumber: po || null },
      lines: parsed?.lines || [],
      confidence: parsed?.confidence ?? null,
      warnings: parsed?.warnings ?? [],
    };
    const done = payload.invoice.source === 'csv'
      ? await finalizeReceiveFromCsv({ venueId, orderId, parsed: payload })
      : await finalizeReceiveFromPdf({ venueId, orderId, parsed: payload });

    return { attached: !!done?.ok, orderId, savedPending: false };
  }

  // 3) Else: store as pending fast receive (match the rules' snapshot envelope)
  const pendingCol = collection(db, 'venues', venueId, 'fastReceives');
  const ref = await addDoc(pendingCol, {
    kind: 'fast_receive_snapshot',
    source: (parsed?.invoice?.source ?? 'unknown'),
    storagePath,
    payload: {
      invoice: { source: parsed?.invoice?.source ?? 'unknown', storagePath, poNumber: po || null },
      lines: parsed?.lines || [],
      confidence: parsed?.confidence ?? null,
      warnings: parsed?.warnings ?? [],
    },
    parsedPo: po || null,
    status: 'pending',
    createdAt: serverTimestamp(),
  });

  return { attached: false, orderId: null, savedPending: true, id: ref.id };
}
