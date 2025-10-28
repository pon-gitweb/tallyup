// src/services/orders/submit.ts
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, updateDoc, serverTimestamp, getDoc, Timestamp
} from 'firebase/firestore';

/** Legacy immediate submit (kept for compatibility) */
export async function submitDraftOrder(venueId: string, orderId: string, uid?: string) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    status: 'submitted',
    displayStatus: 'Submitted',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    submittedBy: uid ?? null,
    updatedBy: uid ?? null,
  });
}

/**
 * Submit with optional merge-hold.
 * Reads per-supplier policy:
 *   - mergeWindowHours (number, optional)
 *   - orderCutoffLocalTime (string "HH:mm", optional)
 *
 * If either is present, we schedule a plannedSubmitAt = now + windowHours,
 * clamped to 30 minutes before the cutoff. Else we submit immediately.
 *
 * When holding:
 *   status: 'pending_merge'
 *   displayStatus: 'Pending merge'
 *   plannedSubmitAt: <Timestamp>
 *   merge: { supplierId, policy: 'window+cutoff', windowHours, cutoffLocalTime, groupKey }
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
      // ignore; fallback to immediate submit below
    }
  }

  // No policy → immediate submit
  if (!mergeWindowHours && !cutoffLocal) {
    await submitDraftOrder(venueId, orderId, opts?.uid);
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
    await submitDraftOrder(venueId, orderId, opts?.uid);
    return;
  }

  // Mark pending_merge with plannedSubmitAt
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
  });
}
