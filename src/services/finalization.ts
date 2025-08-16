import { db } from './firebase';
import {
  collection, doc, getDocs, serverTimestamp, writeBatch, getDoc, setDoc,
} from 'firebase/firestore';

/** Compute venue progress across active departments. */
export async function computeVenueProgress(venueId: string) {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const departments = deptsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  let totalAreas = 0;
  let completeAreas = 0;
  let anyInProgress = false;

  for (const d of departments) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
    const areas = areasSnap.docs.map(a => ({ id: a.id, ...(a.data() as any) }));
    totalAreas += areas.length;

    for (const a of areas) {
      const started = a?.startedAt ?? null;
      const completed = a?.completedAt ?? null;
      if (completed) completeAreas += 1;
      if (started && !completed) anyInProgress = true;
    }
  }

  const allComplete = totalAreas > 0 && completeAreas === totalAreas;
  return { totalAreas, completeAreas, anyInProgress, allComplete, departments };
}

/**
 * Finalize current stock take and immediately reset to a new idle cycle.
 * - Writes sessions/current.lastCompletedAt and status: 'idle'
 * - Resets ALL areas (cycleResetAt + clears startedAt/completedAt)
 * - Optionally stamps departments.completedAt (informational)
 */
export async function finalizeVenueStockTake(venueId: string) {
  // Validate eligibility
  const prog = await computeVenueProgress(venueId);
  if (!prog.allComplete) {
    throw new Error('Cannot finalize: not all areas are complete.');
  }

  const now = serverTimestamp();
  const batch = writeBatch(db);

  // 1) Mark departments completedAt (info only)
  for (const d of prog.departments) {
    const dRef = doc(db, 'venues', venueId, 'departments', d.id);
    batch.set(dRef, { completedAt: now }, { merge: true });

    // 2) Reset all areas in the department
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
    areasSnap.forEach(aDoc => {
      const aRef = doc(db, 'venues', venueId, 'departments', d.id, 'areas', aDoc.id);
      // Matches rules: isCycleReset() (cycleResetAt + started/completed null)
      batch.set(aRef, {
        cycleResetAt: now,
        startedAt: null,
        completedAt: null,
      }, { merge: true });
    });
  }

  // 3) sessions/current: stamp lastCompletedAt and set status back to 'idle'
  const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) {
    // If session somehow missing, create as idle with lastCompletedAt
    batch.set(sRef, { status: 'idle', lastCompletedAt: now, createdAt: now }, { merge: true });
  } else {
    batch.set(sRef, { status: 'idle', lastCompletedAt: now }, { merge: true });
  }

  await batch.commit();
  return { lastCompletedAt: new Date() };
}

/** Ensure 'active' session (used by Start/Return) — convenience if needed elsewhere. */
export async function ensureActiveSession(venueId: string) {
  const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
  const snap = await getDoc(sRef);
  const now = serverTimestamp();
  if (!snap.exists()) {
    await setDoc(sRef, { status: 'active', startedAt: now, createdAt: now }, { merge: true });
    return 'current';
  }
  const status = (snap.data() as any)?.status;
  if (status !== 'active') {
    await setDoc(sRef, { status: 'active', resumedAt: now }, { merge: true });
  }
  return 'current';
}
