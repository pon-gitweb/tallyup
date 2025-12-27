// Domain "repo" layer: owns persistence / Firestore details.
// Keep functions small + testable; services/screens should call via OrdersService/OrdersRepo.

import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';

export type SubmittedOrderLite = {
  id: string;
  poNumber?: string | null;
  supplierName?: string | null;
  createdAt?: any;
};

export const OrdersRepo = {
  async listSubmittedOrders(venueId: string, max: number = 100): Promise<SubmittedOrderLite[]> {
    if (!venueId) return [];
    const db = getFirestore(getApp());
    const q = query(
      collection(db, 'venues', venueId, 'orders'),
      where('status', '==', 'submitted'),
      orderBy('createdAt', 'desc'),
      limit(Math.max(1, Math.min(500, max)))
    );
    const snap = await getDocs(q);
    const out: SubmittedOrderLite[] = [];
    snap.forEach(d => {
      const x: any = d.data() || {};
      out.push({
        id: d.id,
        poNumber: x.poNumber ?? null,
        supplierName: x.supplierName ?? x.supplier ?? null,
        createdAt: x.createdAt ?? null,
      });
    });
    return out;
  },
};
