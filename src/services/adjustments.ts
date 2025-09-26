import {
  addDoc, collection, doc, getDoc, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../services/firebase';

export type AdjustmentRequest = {
  id: string;
  type: 'stock-adjustment-request';
  status: 'pending' | 'approved' | 'denied';
  venueId: string;
  departmentId: string;
  areaId: string;
  itemId: string;
  itemName?: string;
  fromQty?: number | null;
  proposedQty: number;
  reason: string;
  requestedBy?: string | null;
  requestedAt?: any;
  createdAt?: any;
};

const itemRef = (venueId: string, departmentId: string, areaId: string, itemId: string) =>
  doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', itemId);

const sessionRef = (venueId: string, sessionId: string) =>
  doc(db, 'venues', venueId, 'sessions', sessionId);

export async function approveAdjustment(req: AdjustmentRequest, note?: string) {
  const uid = getAuth().currentUser?.uid ?? null;

  // Re-read the session doc to ensure current data and requester identity
  const sref = sessionRef(req.venueId, req.id);
  const ssnap = await getDoc(sref);
  if (!ssnap.exists()) throw new Error('Request no longer exists');

  const fresh = ssnap.data() as AdjustmentRequest;
  if (fresh.status !== 'pending') throw new Error('Request already resolved');

  // SELF-APPROVAL GUARD
  if (uid && fresh.requestedBy && uid === fresh.requestedBy) {
    throw new Error('You cannot approve your own request. Another manager must approve.');
  }

  // Defensive read to ensure item still exists
  const iref = itemRef(req.venueId, req.departmentId, req.areaId, req.itemId);
  const itemSnap = await getDoc(iref);
  if (!itemSnap.exists()) throw new Error('Item no longer exists');

  // 1) Apply the new count
  await updateDoc(iref, {
    lastCount: fresh.proposedQty,
    lastCountAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2) Mark request resolved
  await updateDoc(sref, {
    status: 'approved',
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
    decisionNote: note || null,
  });

  // 3) Optional audit (append-only)
  await addDoc(collection(db, 'venues', req.venueId, 'audits'), {
    type: 'adjustment-approved',
    itemId: req.itemId,
    itemName: req.itemName ?? null,
    fromQty: req.fromQty ?? null,
    toQty: fresh.proposedQty,
    reason: fresh.reason,
    decisionNote: note || null,
    decidedBy: uid,
    decidedAt: serverTimestamp(),
    departmentId: req.departmentId,
    areaId: req.areaId,
    requestId: req.id,
    createdAt: serverTimestamp(),
  });
}

export async function denyAdjustment(req: AdjustmentRequest, reason: string) {
  const uid = getAuth().currentUser?.uid ?? null;
  if (!reason?.trim()) throw new Error('Decision reason is required');

  const sref = sessionRef(req.venueId, req.id);
  const ssnap = await getDoc(sref);
  if (!ssnap.exists()) throw new Error('Request no longer exists');
  const fresh = ssnap.data() as AdjustmentRequest;
  if (fresh.status !== 'pending') throw new Error('Request already resolved');

  await updateDoc(sref, {
    status: 'denied',
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
    decisionNote: reason.trim(),
  });

  await addDoc(collection(db, 'venues', req.venueId, 'audits'), {
    type: 'adjustment-denied',
    itemId: req.itemId,
    itemName: req.itemName ?? null,
    fromQty: req.fromQty ?? null,
    toQty: fresh.proposedQty,
    requestReason: fresh.reason,
    decisionNote: reason.trim(),
    decidedBy: uid,
    decidedAt: serverTimestamp(),
    departmentId: req.departmentId,
    areaId: req.areaId,
    requestId: req.id,
    createdAt: serverTimestamp(),
  });
}
