import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

type NoteStatus = 'open' | 'ordered' | 'resolved';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const ProductNotesAutomation = {
  /**
   * When an order is submitted:
   * - find notes status=open where productId in order productIds
   * - mark them ordered, attach orderId
   * Notes without productId (suggestions) remain open.
   */
  async markNotesOrderedForSubmittedOrder(args: {
    venueId: string;
    orderId: string;
    productIds: string[];
    uid?: string | null;
  }) {
    const { venueId, orderId, productIds, uid } = args;
    if (!venueId || !orderId) return;
    const ids = (productIds || []).map(String).filter(Boolean);

    // Firestore 'in' supports max 10 values
    const batches = chunk(Array.from(new Set(ids)), 10);
    if (!batches.length) return;

    const db = getFirestore(getApp());
    const col = collection(db, 'venues', venueId, 'productNotes');

    for (const group of batches) {
      const qy = query(
        col,
        where('status', '==', 'open'),
        where('productId', 'in', group)
      );

      const snap = await getDocs(qy);
      if (snap.empty) continue;

      const batch = writeBatch(db);
      snap.forEach((d) => {
        batch.update(d.ref, {
          status: 'ordered' as NoteStatus,
          orderedAt: serverTimestamp(),
          orderedBy: uid ?? null,
          orderId,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  },

  /**
   * When an order is received:
   * - find notes status=ordered where orderId == this orderId
   * - mark them resolved
   */
  async resolveNotesForReceivedOrder(args: {
    venueId: string;
    orderId: string;
    uid?: string | null;
  }) {
    const { venueId, orderId, uid } = args;
    if (!venueId || !orderId) return;

    const db = getFirestore(getApp());
    const col = collection(db, 'venues', venueId, 'productNotes');

    const qy = query(
      col,
      where('status', '==', 'ordered'),
      where('orderId', '==', orderId)
    );

    const snap = await getDocs(qy);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.forEach((d) => {
      batch.update(d.ref, {
        status: 'resolved' as NoteStatus,
        resolvedAt: serverTimestamp(),
        resolvedBy: uid ?? null,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  },
};
