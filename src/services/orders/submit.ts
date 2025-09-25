import { getApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export async function submitDraftOrder(venueId: string, orderId: string, uid?: string) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    status: 'submitted',
    submittedAt: serverTimestamp(),
    submittedBy: uid ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: uid ?? null,
  });
}
