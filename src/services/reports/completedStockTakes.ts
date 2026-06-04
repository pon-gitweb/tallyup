// @ts-nocheck
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

export type CompletedStockTakeRow = {
  id: string;
  cycleNumber: number;
  departmentId: string;
  departmentName: string;
  completedAt: any | null;
  completedByName: string | null;
  totalItemsCounted: number;
  totalStockValue: number | null;
  itemsBelowPAR: number;
  durationMinutes: number | null;
  // Legacy fields kept so old callers that read .status / .createdAt don't crash
  status?: string | null;
  createdAt?: any | null;
};

export async function listCompletedStockTakes(
  venueId: string,
): Promise<CompletedStockTakeRow[]> {
  if (!venueId) return [];
  const db = getFirestore();
  const results: CompletedStockTakeRow[] = [];

  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  for (const deptDoc of deptsSnap.docs) {
    try {
      const snapsQ = query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('completedAt', 'desc'),
        limit(20),
      );
      const snapsSnap = await getDocs(snapsQ);
      for (const snapDoc of snapsSnap.docs) {
        const data = snapDoc.data() as any;
        results.push({
          id: snapDoc.id,
          cycleNumber: typeof data.cycleNumber === 'number' ? data.cycleNumber : 1,
          departmentId: deptDoc.id,
          departmentName: data.departmentName || (deptDoc.data() as any).name || deptDoc.id,
          completedAt: data.completedAt ?? null,
          completedByName: data.completedByName ?? null,
          totalItemsCounted: data.summary?.totalItemsCounted ?? 0,
          totalStockValue: typeof data.summary?.totalStockValue === 'number'
            ? data.summary.totalStockValue
            : null,
          itemsBelowPAR: data.summary?.itemsBelowPAR ?? 0,
          durationMinutes: typeof data.durationMinutes === 'number' ? data.durationMinutes : null,
          status: 'completed',
        });
      }
    } catch {
      // Dept has no snapshots yet — skip silently
    }
  }

  results.sort((a, b) => {
    const aMs = a.completedAt?.toMillis?.()
      ?? (a.completedAt?._seconds ? a.completedAt._seconds * 1000 : 0);
    const bMs = b.completedAt?.toMillis?.()
      ?? (b.completedAt?._seconds ? b.completedAt._seconds * 1000 : 0);
    return bMs - aMs;
  });

  return results;
}
