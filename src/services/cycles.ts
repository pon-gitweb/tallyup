import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { ensureDeptSessionActive } from 'src/services/activeDeptTake';

/**
 * Start a new stock-take cycle for a department.
 * - Clears startedAt/completedAt on all areas in that department (does not delete lastCount history).
 * - Ensures the dept session is 'active' again.
 */
export async function startNewDepartmentCycle(venueId: string, departmentId: string) {
  const areasCol = collection(db, `venues/${venueId}/departments/${departmentId}/areas`);
  const snap = await getDocs(areasCol);
  const now = serverTimestamp();

  // Reset area state for the new cycle
  for (const a of snap.docs) {
    const areaRef = doc(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}`);
    await setDoc(
      areaRef,
      { startedAt: null, completedAt: null, cycleResetAt: now },
      { merge: true }
    );
  }

  // Mark department session active again (so UI can colorize / resume properly)
  await ensureDeptSessionActive(venueId, departmentId);
}
