import {
  collection, collectionGroup, getDocs, writeBatch, doc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '../services/firebase';

/**
 * Normalize an area's progress flags to "not started".
 * We set startedAt=null and completedAt=null, and stamp cycleResetAt/updatedAt.
 * This matches the allowed keysets in your rules.
 */
function resetAreaInBatch(batch: ReturnType<typeof writeBatch>, areaRef: any, now: any) {
  batch.update(areaRef, {
    startedAt: null,
    completedAt: null,
    cycleResetAt: now,
    updatedAt: now,
  });
}

/**
 * Per-department reset:
 * - Clears startedAt/completedAt on ALL areas under venues/{venue}/departments/{dep}/areas
 * - Also clears any legacy venue-level areas that are tagged with departmentId==depId (if present)
 */
export async function resetDepartment(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) return;
  const now = serverTimestamp();

  const batch = writeBatch(db);

  // 1) Nested: venues/{venue}/departments/{dep}/areas/*
  const nestedAreasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas'));
  nestedAreasSnap.forEach((d) => {
    const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', d.id);
    resetAreaInBatch(batch, aRef, now);
  });

  // 2) Legacy shortcut: venues/{venue}/areas/* where departmentId == dep
  // (Only applies if your legacy docs carried departmentId; harmless if none)
  const legacyAreasCol = collection(db, 'venues', venueId, 'areas');
  try {
    const legacyQ = query(legacyAreasCol, where('departmentId', '==', departmentId));
    const legacySnap = await getDocs(legacyQ);
    legacySnap.forEach((d) => {
      const aRef = doc(db, 'venues', venueId, 'areas', d.id);
      resetAreaInBatch(batch, aRef, now);
    });
  } catch {
    // If the index/field doesn't exist or structure isn't there, silently ignore.
  }

  await batch.commit();
}

/**
 * Venue-wide "nuclear" reset (owner/manager):
 * - Iterates ALL departments and resets all nested areas
 * - Also sweeps legacy venue-level areas (no department filter)
 * - Updates venues/{venue}.cycleResetAt to allow UI cache busts / status recompute
 */
export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) return;
  const now = serverTimestamp();
  const batch = writeBatch(db);

  // A) Reset nested areas under each department
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of depsSnap.docs) {
    const depId = dep.id;
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
    areasSnap.forEach((a) => {
      const aRef = doc(db, 'venues', venueId, 'departments', depId, 'areas', a.id);
      resetAreaInBatch(batch, aRef, now);
    });
  }

  // B) Sweep legacy venue-level areas (if still present)
  const venueAreasSnap = await getDocs(collection(db, 'venues', venueId, 'areas'));
  venueAreasSnap.forEach((a) => {
    const aRef = doc(db, 'venues', venueId, 'areas', a.id);
    resetAreaInBatch(batch, aRef, now);
  });

  // C) Update venue root cycleResetAt (allowed by your rules)
  const venueRef = doc(db, 'venues', venueId);
  batch.update(venueRef, { cycleResetAt: now, updatedAt: now });

  await batch.commit();
}
