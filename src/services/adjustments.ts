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

  // Defensive read to ensure doc still exists
  const iref = itemRef(req.venueId, req.departmentId, req.areaId, req.itemId);
  const itemSnap = await getDoc(iref);
  if (!itemSnap.exists()) throw new Error('Item no longer exists');

  // 1) Apply the new count
  await updateDoc(iref, {
    lastCount: req.proposedQty,
    lastCountAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2) Mark request resolved
  await updateDoc(sessionRef(req.venueId, req.id), {
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
    toQty: req.proposedQty,
    reason: req.reason,
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

  await updateDoc(sessionRef(req.venueId, req.id), {
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
    toQty: req.proposedQty,
    requestReason: req.reason,
    decisionNote: reason.trim(),
    decidedBy: uid,
    decidedAt: serverTimestamp(),
    departmentId: req.departmentId,
    areaId: req.areaId,
    requestId: req.id,
    createdAt: serverTimestamp(),
  });
}
