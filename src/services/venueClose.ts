import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { listIncompleteAreasAcrossActive, finalizeVenueIfAllActiveComplete } from 'src/services/completion';
import { setLastLocation } from 'src/services/activeTake';

/**
 * Strictly finalizes the venue stock take (ACTIVE departments only),
 * then resets all ACTIVE departments to a clean state and sets the venue session to 'idle'.
 *
 * This makes the Dashboard primary button show "Start Stock Take" (idle) immediately after finalization.
 *
 * Returns:
 *  - { ok: true, restarted: true } when finalize succeeded and reset-to-idle was done
 *  - { ok: false, missing: string[] } when areas were incomplete (no changes performed)
 */
export async function finalizeAndRestartVenueCycle(venueId: string): Promise<
  | { ok: true; restarted: true }
  | { ok: false; missing: string[] }
> {
  // 1) Ensure everything is complete across ACTIVE departments
  const missing = await listIncompleteAreasAcrossActive(venueId);
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  // 2) Finalize the venue (commit timestamps, etc.)
  const finalized = await finalizeVenueIfAllActiveComplete(venueId);
  if (!finalized) {
    // Defensive: if something changed between checks, treat as not ready
    return { ok: false, missing: await listIncompleteAreasAcrossActive(venueId) };
  }

  // 3) Reset ACTIVE departments to a fresh (not started) state
  //    - Clear startedAt/completedAt on all areas
  //    - Clear departments.completedAt
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  const now = serverTimestamp();

  for (const d of depts.docs) {
    const dv = d.data() as any;
    const active = typeof dv?.active === 'boolean' ? dv.active : true;
    if (!active) continue;

    // Clear dept completion
    await setDoc(doc(db, `venues/${venueId}/departments/${d.id}`), {
      completedAt: null,
      cycleResetAt: now,
    }, { merge: true });

    // Clear all areas under the department
    const areas = await getDocs(collection(db, `venues/${venueId}/departments/${d.id}/areas`));
    for (const a of areas.docs) {
      await setDoc(doc(db, `venues/${venueId}/departments/${d.id}/areas/${a.id}`), {
        startedAt: null,
        completedAt: null,
        cycleResetAt: now,
      }, { merge: true });
    }
  }

  // 4) Set venue session to IDLE (not active) and clear last location pointer
  await setDoc(doc(db, `venues/${venueId}/sessions/current`), {
    status: 'idle',
    restartedAt: now,
  }, { merge: true });

  await setLastLocation(venueId, { lastDepartmentId: null, lastAreaId: null });

  return { ok: true, restarted: true };
}
