import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from 'src/services/firebase';

/** Departments marked active=false are ignored for venue completion. */
export async function getActiveDepartmentIds(venueId: string): Promise<string[]> {
  const snap = await getDocs(collection(db, `venues/${venueId}/departments`));
  const ids: string[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    const active = typeof data?.active === 'boolean' ? data.active : true;
    if (active) ids.push(d.id);
  });
  return ids;
}

/** True only if every area in every ACTIVE department has completedAt. */
export async function isVenueCompleteAcrossActiveDepts(venueId: string): Promise<boolean> {
  const deptIds = await getActiveDepartmentIds(venueId);
  if (deptIds.length === 0) return false; // nothing configured yet
  for (const depId of deptIds) {
    const areas = await getDocs(collection(db, `venues/${venueId}/departments/${depId}/areas`));
    if (areas.empty) return false;
    let allDone = true;
    areas.forEach((a) => {
      const data = a.data() as any;
      if (!data?.completedAt) allDone = false;
    });
    if (!allDone) return false;
  }
  return true;
}

/** Returns a list of "Dept > Area" that are incomplete, considering ACTIVE departments only. */
export async function listIncompleteAreasAcrossActive(venueId: string): Promise<string[]> {
  const out: string[] = [];
  const deptsSnap = await getDocs(collection(db, `venues/${venueId}/departments`));
  for (const d of deptsSnap.docs) {
    const dv = d.data() as any;
    const active = typeof dv?.active === 'boolean' ? dv.active : true;
    if (!active) continue;
    const depName = dv?.name || d.id;
    const areas = await getDocs(collection(db, `venues/${venueId}/departments/${d.id}/areas`));
    areas.forEach((a) => {
      const av = a.data() as any;
      if (!av?.completedAt) {
        const aName = av?.name || a.id;
        out.push(`• ${depName} > ${aName}`);
      }
    });
  }
  return out;
}

/**
 * Finalize the venue-level stock take record.
 * This writes to venues/{venueId}/sessions/current with status=completed
 * (and merges if the doc already exists).
 */
export async function finalizeVenueStockTake(venueId: string) {
  const ref = doc(db, `venues/${venueId}/sessions/current`);
  await setDoc(
    ref,
    { status: 'completed', completedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * If all ACTIVE depts are complete, finalize the venue session.
 * Returns true if finalized, false otherwise.
 */
export async function finalizeVenueIfAllActiveComplete(venueId: string): Promise<boolean> {
  const ok = await isVenueCompleteAcrossActiveDepts(venueId);
  if (!ok) return false;
  await finalizeVenueStockTake(venueId);
  return true;
}

/** Convenience to read venue session (for dashboard ribbons, etc.) */
export async function getVenueSession(venueId: string): Promise<any | null> {
  const r = await getDoc(doc(db, `venues/${venueId}/sessions/current`));
  return r.exists() ? (r.data() as any) : null;
}
