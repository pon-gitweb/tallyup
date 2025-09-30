// @ts-nocheck
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Approve a count directly (manager action).
 * - Updates the item's lastCount/lastCountAt.
 * - Writes a lightweight audit row under venues/{venueId}/audits (non-breaking).
 *   If you already have a richer audits pipeline, this extra doc is harmless.
 */
type Args = {
  venueId: string;
  departmentId: string;
  areaId: string;
  itemId: string;
  itemName?: string;
  fromQty: number | null;
  toQty: number;
  reason?: string;
  decidedByUid?: string | null;
};

export async function approveDirectCount(args: Args): Promise<void> {
  const {
    venueId, departmentId, areaId, itemId, itemName,
    fromQty, toQty, reason, decidedByUid
  } = args;

  // 1) Update the item with the approved quantity
  await updateDoc(
    doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', itemId),
    { lastCount: toQty, lastCountAt: serverTimestamp(), updatedAt: serverTimestamp() }
  );

  // 2) Lightweight audit trail (kept generic to avoid schema coupling)
  try {
    await addDoc(collection(db, 'venues', venueId, 'audits'), {
      type: 'inline-approve',
      venueId,
      departmentId,
      areaId,
      itemId,
      itemName: itemName ?? null,
      fromQty: fromQty ?? null,
      toQty,
      reason: reason ?? 'Inline approve (manager)',
      decidedByUid: decidedByUid ?? null,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Best-effort: even if audit write fails, the primary update succeeded.
  }
}
