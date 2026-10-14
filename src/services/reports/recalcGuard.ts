import { collection, getDocs } from 'firebase/firestore';

export async function checkCountsChangedSince(
  db: any,
  venueId: string,
  deptId: string,
  cycleCompletedAtMs: number,
): Promise<boolean> {
  try {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptId, 'areas'));
    for (const areaDoc of areasSnap.docs) {
      const itemsSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', deptId, 'areas', areaDoc.id, 'items'),
      );
      for (const itemDoc of itemsSnap.docs) {
        const lca = (itemDoc.data() as any).lastCountAt;
        const lcaMs = lca?.toMillis?.() ?? (lca?.seconds ? lca.seconds * 1000 : 0);
        if (lcaMs > cycleCompletedAtMs) return true;
      }
    }
  } catch {}
  return false;
}
