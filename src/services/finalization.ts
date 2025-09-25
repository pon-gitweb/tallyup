import { db } from './firebase';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { resetVenueCycle } from './session';

function toMillis(val: any | undefined | null): number | null {
  // Firestore Timestamp: { seconds, nanoseconds, toDate() }
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  // Allow passing JS Date or ms in rare cases
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  return null;
}

/**
 * Compute cycle window for a venue by scanning all areas across departments.
 * Returns the earliest startedAt and latest completedAt that exist.
 */
export async function computeCycleWindow(venueId: string): Promise<{
  firstStartMs: number | null;
  lastCompleteMs: number | null;
}> {
  let firstStart: number | null = null;
  let lastComplete: number | null = null;

  const dcol = collection(db, 'venues', venueId, 'departments');
  const deps = await getDocs(dcol);
  for (const d of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
    areas.forEach(a => {
      const data: any = a.data();
      const s = toMillis(data?.startedAt);
      const c = toMillis(data?.completedAt);
      if (s != null) {
        if (firstStart == null || s < firstStart) firstStart = s;
      }
      if (c != null) {
        if (lastComplete == null || c > lastComplete) lastComplete = c;
      }
    });
  }
  return { firstStartMs: firstStart, lastCompleteMs: lastComplete };
}

/**
 * Returns the cycle duration in hours if both endpoints exist; otherwise null.
 */
export async function getCycleDurationHours(venueId: string): Promise<number | null> {
  const { firstStartMs, lastCompleteMs } = await computeCycleWindow(venueId);
  if (firstStartMs == null || lastCompleteMs == null) return null;
  const diffMs = Math.max(0, lastCompleteMs - firstStartMs);
  return diffMs / (1000 * 60 * 60);
}

/**
 * Mark venue lastCompletedAt and reset cycle flags, safely per rules.
 */
export async function finalizeVenueCycle(venueId: string): Promise<void> {
  // lastCompletedAt server timestamp
  await setDoc(doc(db, 'venues', venueId), { lastCompletedAt: serverTimestamp() }, { merge: true });
  // reset cycle flags (uses your existing logic; Expo-safe)
  await resetVenueCycle(venueId);
}
