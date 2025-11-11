import { getFirestore, collection, getDocs, query, where, writeBatch, doc, Timestamp } from 'firebase/firestore';

type Opts = { withUpdatedAt?: boolean };

export async function resetAllDepartmentsStockTake(venueId: string, opts: Opts = {}) {
  const db = getFirestore();
  const now = Timestamp.now();
  const payload: any = { cycleResetAt: now };
  if (opts.withUpdatedAt) payload.updatedAt = now;

  const batch = writeBatch(db);

  // Pass A: venue-level areas -> /venues/{venueId}/areas/*
  const venueAreasCol = collection(db, 'venues', venueId, 'areas');
  const venueAreasSnap = await getDocs(venueAreasCol);
  venueAreasSnap.forEach(a => {
    batch.set(doc(db, 'venues', venueId, 'areas', a.id), payload, { merge: true });
  });

  // Pass B: nested areas -> /venues/{venueId}/departments/*/areas/*
  const deptsCol = collection(db, 'venues', venueId, 'departments');
  const deptsSnap = await getDocs(deptsCol);
  for (const d of deptsSnap.docs) {
    const areasCol = collection(db, 'venues', venueId, 'departments', d.id, 'areas');
    const areasSnap = await getDocs(areasCol);
    areasSnap.forEach(a => {
      batch.set(doc(db, 'venues', venueId, 'departments', d.id, 'areas', a.id), payload, { merge: true });
    });
  }

  await batch.commit();
  return { resetAt: now.toDate(), venueAreas: venueAreasSnap.size, nestedDepts: deptsSnap.size };
}
