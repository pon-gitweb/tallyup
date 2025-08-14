import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { endActiveSession } from 'src/services/activeTake';

/** Mark an area as completed (idempotent) */
export async function markAreaCompleted(venueId: string, departmentId: string, areaId: string) {
  const ref = doc(db, `venues/${venueId}/departments/${departmentId}/areas/${areaId}`);
  await setDoc(ref, { completedAt: serverTimestamp() }, { merge: true });
}

/** True if ALL areas in ALL departments are completed */
export async function isWholeVenueComplete(venueId: string): Promise<boolean> {
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  if (depts.empty) return false;
  for (const d of depts.docs) {
    const areas = await getDocs(collection(db, `venues/${venueId}/departments/${d.id}/areas`));
    if (areas.empty) return false;
    for (const a of areas.docs) {
      const data = a.data() as any;
      if (!data?.completedAt) return false;
    }
  }
  return true;
}

/** Optionally record a venue-level “completedAt” summary doc (sessions/current already stores status) */
export async function stampVenueCompleted(venueId: string) {
  const ref = doc(db, `venues/${venueId}`);
  await updateDoc(ref, { lastCompletedAt: serverTimestamp() });
}

/** Finalize entire stock take now (updates sessions/current + optional venue stamp) */
export async function finalizeWholeStockTake(venueId: string) {
  await endActiveSession(venueId);
  await stampVenueCompleted(venueId);
}
