// @ts-nocheck
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from './firebase';
import { OrdersService } from '../domain/orders';

export type BudgetOverrideRequest = {
  id: string;
  type: 'budget-override-request';
  status: 'pending' | 'approved' | 'rejected';
  venueId: string;
  orderId: string;
  supplierId: string | null;
  supplierName: string | null;
  orderTotal: number;
  budgetAmount: number;
  budgetId: string;
  overBy: number;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: any;
  resolvedBy: string | null;
  resolvedAt: any;
  note: string | null;
};

export async function requestBudgetOverride(
  venueId: string,
  orderId: string,
  supplierId: string | null,
  supplierName: string | null,
  orderTotal: number,
  budgetId: string,
  budgetAmount: number,
  overBy: number,
): Promise<{ id: string }> {
  const uid = getAuth().currentUser?.uid ?? null;
  const displayName = getAuth().currentUser?.displayName || getAuth().currentUser?.email || null;
  const ref = await addDoc(collection(db, 'venues', venueId, 'sessions'), {
    type: 'budget-override-request',
    status: 'pending',
    venueId,
    orderId,
    supplierId: supplierId ?? null,
    supplierName: supplierName ?? null,
    orderTotal,
    budgetAmount,
    budgetId,
    overBy,
    requestedBy: uid,
    requestedByName: displayName,
    requestedAt: serverTimestamp(),
    resolvedBy: null,
    resolvedAt: null,
    note: null,
  });
  // Put order into pending-approval status
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'pending-approval',
    pendingApprovalSessionId: ref.id,
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}

export async function approveBudgetOverride(
  venueId: string,
  request: BudgetOverrideRequest,
  note?: string,
): Promise<void> {
  const uid = getAuth().currentUser?.uid ?? null;
  if (!uid) throw new Error('Not authenticated');
  if (uid === request.requestedBy) throw new Error('You cannot approve your own request.');
  const sref = doc(db, 'venues', venueId, 'sessions', request.id);
  const snap = await getDoc(sref);
  if (!snap.exists()) throw new Error('Request no longer exists');
  if ((snap.data() as any).status !== 'pending') throw new Error('Request already resolved');
  // Submit the order
  await OrdersService.submitOrHoldDraftOrder(venueId, request.orderId, request.supplierId, { defaultWindowHours: 8 });
  // Mark resolved
  await updateDoc(sref, {
    status: 'approved',
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
    note: note || null,
  });
}

export async function rejectBudgetOverride(
  venueId: string,
  request: BudgetOverrideRequest,
  note?: string,
): Promise<void> {
  const uid = getAuth().currentUser?.uid ?? null;
  if (!uid) throw new Error('Not authenticated');
  const sref = doc(db, 'venues', venueId, 'sessions', request.id);
  const snap = await getDoc(sref);
  if (!snap.exists()) throw new Error('Request no longer exists');
  if ((snap.data() as any).status !== 'pending') throw new Error('Request already resolved');
  // Return order to draft
  await updateDoc(doc(db, 'venues', venueId, 'orders', request.orderId), {
    status: 'draft',
    pendingApprovalSessionId: null,
    updatedAt: serverTimestamp(),
  });
  // Mark resolved
  await updateDoc(sref, {
    status: 'rejected',
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
    note: note || null,
  });
}
