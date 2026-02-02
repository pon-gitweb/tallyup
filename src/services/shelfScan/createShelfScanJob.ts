// @ts-nocheck
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export async function createShelfScanJob({
  venueId,
  departmentId,
  areaId,
  areaNameSnapshot,
  storagePath,
  createdBy,
}: {
  venueId: string;
  departmentId: string;
  areaId: string;
  areaNameSnapshot?: string | null;
  storagePath: string;
  createdBy: string | null;
}) {
  const ref = await addDoc(collection(db, 'venues', venueId, 'shelfScanJobs'), {
    status: 'uploaded', // uploaded -> processing -> done|failed
    venueId,
    departmentId,
    areaId,
    areaNameSnapshot: areaNameSnapshot ?? null,
    storagePath,
    createdBy: createdBy ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}
