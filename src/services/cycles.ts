import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { ensureDeptSessionActive } from 'src/services/activeDeptTake';

/**
 * Start a new stock-take cycle for a department.
 * - Clears startedAt/completedAt on all areas in that department (does not delete lastCount history).
 * - Clears department.completedAt (so the department is no longer "complete").
 * - Ensures the dept session is 'active' again.
 */
export async function startNewDepartmentCycle(venueId: string, departmentId: string) {
  const areasCol = collection(db, `venues/${venueId}/departments/${departmentId}/areas`);
  const snap = await getDocs(areasCol);
  const now = serverTimestamp();

  for (const a of snap.docs) {
    const areaRef = doc(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}`);
    await setDoc(
      areaRef,
      { startedAt: null, completedAt: null, cycleResetAt: now },
      { merge: true }
    );
  }

  // Clear department completion flag
  await setDoc(doc(db, `venues/${venueId}/departments/${departmentId}`), {
    completedAt: null,
    cycleResetAt: now,
  }, { merge: true });

  await ensureDeptSessionActive(venueId, departmentId);
}

/**
 * Start a new stock-take cycle for ALL ACTIVE departments in a venue.
 * Departments with active=false are skipped.
 */
export async function startNewVenueCycle(venueId: string) {
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  for (const d of depts.docs) {
    const data = d.data() as any;
    const active = typeof data?.active === 'boolean' ? data.active : true;
    if (!active) continue;
    await startNewDepartmentCycle(venueId, d.id);
  }
  // Reset or mark venue session as active
  await setDoc(doc(db, `venues/${venueId}/sessions/current`), {
    status: 'active',
    restartedAt: serverTimestamp(),
  }, { merge: true });
}
