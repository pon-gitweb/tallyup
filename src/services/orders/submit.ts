// src/services/orders/submit.ts
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, updateDoc, serverTimestamp, getDoc, Timestamp, deleteField, runTransaction, setDoc
} from 'firebase/firestore';

function yyyymmdd(d: Date){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}
function venueShort(venueId: string){
  const s = String(venueId||'').replace(/[^a-zA-Z0-9]/g,'');
  return s.slice(-5) || 'VENUE';
}

async function ensurePoFields(db: ReturnType<typeof getFirestore>, venueId: string, orderId: string){
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const v: any = snap.data() || {};
  if (v.poNumber && v.poDate) return; // already set

  const now = new Date();
  const dateKey = yyyymmdd(now);
  const counterRef = doc(db, 'venues', venueId, 'counters', 'orders', dateKey);

  const nextSeq = await runTransaction(db, async (tx) => {
    const cs = await tx.get(counterRef);
    let seq = 1;
    if (cs.exists()) {
      const cur = Number(cs.get('seq') || 0);
      seq = (cur || 0) + 1;
      tx.update(counterRef, { seq });
    } else {
      tx.set(counterRef, { seq: 1, dateKey, createdAt: serverTimestamp() });
      seq = 1;
    }
    return seq;
  });

  const seq4 = String(nextSeq).padStart(4, '0');
  const poNumber = `PO-${dateKey}-${venueShort(venueId)}-${seq4}`;

  await updateDoc(ref, {
    poNumber,
    poDate: serverTimestamp(),
  });
}

/**
 * Finalize an order to clean "submitted" state and scrub any merge/hold flags.
 * This is the single source of truth for a clean Submitted write.
 */
export async function finalizeToSubmitted(
  venueId: string,
  orderId: string,
  uid?: string
) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);

  // 1) Set submitted status and scrub flags
  await updateDoc(ref, {
    status: 'submitted',
    displayStatus: 'submitted',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    submittedBy: uid ?? null,
    updatedBy: uid ?? null,

    plannedSubmitAt: deleteField(),
    isConsolidating: deleteField(),
    submitHoldUntil: deleteField(),
    cutoffAt: deleteField(),
    merge: deleteField(),
    queued: deleteField(),
    pending: deleteField(),
    pendingReason: deleteField(),
  });

  // 2) Ensure PO fields present (idempotent)
  await ensurePoFields(db, venueId, orderId);
}

/** Legacy immediate submit (kept for compatibility) */
export async function submitDraftOrder(venueId: string, orderId: string, uid?: string) {
  await finalizeToSubmitted(venueId, orderId, uid);
}

/**
 * Submit with optional merge-hold policy.
 * If no effective policy → immediate submit (finalizeToSubmitted).
 * If there is a policy → mark pending_merge and plannedSubmitAt (no submittedAt yet).
 */
export async function submitOrHoldDraftOrder(
  venueId: string,
  orderId: string,
  supplierId: string | null | undefined,
  opts?: { defaultWindowHours?: number; uid?: string }
) {
  const db = getFirestore(getApp());
  const now = new Date();

  let mergeWindowHours: number | null = null;
  let cutoffLocal: string | null = null;

  if (venueId && supplierId) {
    try {
      const sref = doc(db, 'venues', venueId, 'suppliers', supplierId);
      const ssnap = await getDoc(sref);
      if (ssnap.exists()) {
        const sv = ssnap.data() as any;
        const rawH = sv?.mergeWindowHours;
        mergeWindowHours = Number.isFinite(rawH) ? Number(rawH) : (opts?.defaultWindowHours ?? null);
        const rawCut = (sv?.orderCutoffLocalTime || '').trim();
        cutoffLocal = rawCut && /^\d{2}:\d{2}$/.test(rawCut) ? rawCut : null;
      }
    } catch {
      // ignore
    }
  }

  // No policy → immediate submit (and scrub flags + ensure PO)
  if (!mergeWindowHours && !cutoffLocal) {
    await finalizeToSubmitted(venueId, orderId, opts?.uid);
    return;
  }

  // Compute planned = now + window
  const hours = mergeWindowHours && mergeWindowHours > 0 ? mergeWindowHours : (opts?.defaultWindowHours ?? 0);
  let planned = new Date(now.getTime() + hours * 3600 * 1000);

  // Clamp to (cutoff - 30m) if earlier and still in future
  if (cutoffLocal) {
    const [hh, mm] = cutoffLocal.split(':').map((x: string) => parseInt(x, 10));
    const cutoff = new Date(now);
    cutoff.setHours(hh, mm, 0, 0);
    if (cutoff.getTime() <= now.getTime()) cutoff.setDate(cutoff.getDate() + 1);
    const cutoffMinus30 = new Date(cutoff.getTime() - 30 * 60 * 1000);
    if (cutoffMinus30.getTime() < planned.getTime() && cutoffMinus30.getTime() > now.getTime()) {
      planned = cutoffMinus30;
    }
  }

  // If somehow not in the future, submit now
  if (planned.getTime() <= now.getTime()) {
    await finalizeToSubmitted(venueId, orderId, opts?.uid);
    return;
  }

  // Pending merge (no submittedAt yet)
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  const groupKey = `${supplierId || 'unassigned'}:${planned.toISOString().slice(0, 13)}`; // hourly bucket
  await updateDoc(ref, {
    status: 'pending_merge',
    displayStatus: 'Pending merge',
    plannedSubmitAt: Timestamp.fromDate(planned),
    updatedAt: serverTimestamp(),
    updatedBy: opts?.uid ?? null,
    merge: {
      supplierId: supplierId ?? null,
      policy: 'window+cutoff',
      windowHours: hours || null,
      cutoffLocalTime: cutoffLocal,
      groupKey,
    },

    submittedAt: deleteField(),
    submittedBy: deleteField(),
  });
}
