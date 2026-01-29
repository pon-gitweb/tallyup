import {
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../services/firebase';

const CHUNK = 400;

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function commitBatches(refs: any[], apply: (batch: any, ref: any) => void) {
  for (const group of chunk(refs, CHUNK)) {
    const batch = writeBatch(db);
    for (const ref of group) apply(batch, ref);
    await batch.commit();
  }
}

async function collectDepartmentAreaRefs(venueId: string, departmentId: string) {
  const refs: any[] = [];

  // Nested areas: venues/{venue}/departments/{dep}/areas/*
  const nestedSnap = await getDocs(
    collection(db, 'venues', venueId, 'departments', departmentId, 'areas')
  );
  nestedSnap.forEach((d) => refs.push(d.ref));

  // Legacy areas: venues/{venue}/areas/* where departmentId == dep (optional)
  try {
    const legacyQ = query(
      collection(db, 'venues', venueId, 'areas'),
      where('departmentId', '==', departmentId)
    );
    const legacySnap = await getDocs(legacyQ);
    legacySnap.forEach((d) => refs.push(d.ref));
  } catch {}

  return refs;
}

/**
 * Per-department reset (lock-safe):
 * PASS A: clear currentLock ONLY (rules require changedKeys == ['currentLock'])
 * PASS B: reset startedAt/completedAt + cycleResetAt/updatedAt
 */
export async function resetDepartment(venueId: string, departmentId: string) {
  if (!venueId || !departmentId) return;

  const refs = await collectDepartmentAreaRefs(venueId, departmentId);
  const now = serverTimestamp();

  // PASS A — clear locks (single-key updates)
  await commitBatches(refs, (batch, ref) => {
    batch.update(ref, { currentLock: null });
  });

  // PASS B — reset progress flags (no currentLock included)
  await commitBatches(refs, (batch, ref) => {
    batch.update(ref, {
      startedAt: null,
      completedAt: null,
      cycleResetAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Venue-wide reset (owner/manager):
 * - clears locks on ALL areas
 * - resets progress flags on ALL areas
 * - bumps venues/{venue}.cycleResetAt/updatedAt
 */
export async function resetAllDepartmentsStockTake(venueId: string) {
  if (!venueId) return;

  const refs: any[] = [];
  const now = serverTimestamp();

  // All nested areas under all departments
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(
      collection(db, 'venues', venueId, 'departments', dep.id, 'areas')
    );
    areasSnap.forEach((a) => refs.push(a.ref));
  }

  // All legacy venue-level areas (if still present)
  const legacySnap = await getDocs(collection(db, 'venues', venueId, 'areas'));
  legacySnap.forEach((a) => refs.push(a.ref));

  // PASS A — clear locks
  await commitBatches(refs, (batch, ref) => {
    batch.update(ref, { currentLock: null });
  });

  // PASS B — reset progress flags
  await commitBatches(refs, (batch, ref) => {
    batch.update(ref, {
      startedAt: null,
      completedAt: null,
      cycleResetAt: now,
      updatedAt: now,
    });
  });

  // bump venue root (rules allow only these keys)
  const venueRef = doc(db, 'venues', venueId);
  const batch = writeBatch(db);
  batch.update(venueRef, { cycleResetAt: now, updatedAt: now });
  await batch.commit();
}
