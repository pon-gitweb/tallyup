// @ts-nocheck
// [diag] FastReceive snapshot write — logs collection path + keys on failure
import { getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ParsedInvoicePayload } from './reconciliationStore.types'; // keep or remove if you already have types

export async function persistFastReceiveSnapshot(args: {
  venueId: string;
  source: 'csv'|'pdf'|'manual';
  storagePath: string;
  payload: ParsedInvoicePayload | any;
  parsedPo?: string | null;
}) {
  try {
    const db = getFirestore(getApp());
    const col = collection(db, 'venues', args.venueId, 'fastReceives');
    if (__DEV__) try {
      console.log('[FastReceive][FS] path', `venues/${args.venueId}/fastReceives`, 'keys', Object.keys(args || {}));
    } catch {}

    const toWrite = {
      kind: 'fast_receive_snapshot',
      source: args.source,
      storagePath: String(args.storagePath || ''),
      payload: args.payload || null,
      parsedPo: (args.parsedPo ?? null) as string | null,
      status: 'pending' as const,
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(col, toWrite);
    return { ok: true, id: docRef.id };
  } catch (e: any) {
    try {
      console.log('[FastReceive][FS] FAIL', {
        venueId: args?.venueId,
        source: args?.source,
        storagePath: args?.storagePath,
        err: (e && (e.code || e.message || String(e))),
      });
    } catch {}
    if (__DEV__) console.log('[persistFastReceiveSnapshot] error', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Save the reconciliation bundle returned by the REST API.
 * Used by finalizeReceiveFromCsv / finalizeReceiveFromPdf.
 */
export async function saveReconciliation(
  venueId: string,
  orderId: string,
  payload: any
) {
  try {
    const db = getFirestore(getApp());
    const col = collection(db, 'venues', venueId, 'orders', orderId, 'reconciliations');

    const toWrite = {
      createdAt: serverTimestamp(),
      venueId,
      orderId,
      ...payload,
    };

    const docRef = await addDoc(col, toWrite);

    if (__DEV__) {
      try {
        console.log('[Reconcile][FS] saved reconciliation', {
          venueId,
          orderId,
          id: docRef.id,
          hasSummary: !!payload?.summary,
        });
      } catch {}
    }

    return { ok: true, id: docRef.id };
  } catch (e: any) {
    try {
      console.log('[Reconcile][FS] saveReconciliation FAIL', {
        venueId,
        orderId,
        err: (e && (e.code || e.message || String(e))),
      });
    } catch {}
    if (__DEV__) console.log('[saveReconciliation] error', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}
