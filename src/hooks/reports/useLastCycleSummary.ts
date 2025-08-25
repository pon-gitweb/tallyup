import { useEffect, useMemo, useState } from 'react';
import {
  getFirestore, collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { computeLastCycleSummary, LastCycleSummary, CycleItemLike } from '../../lib/lastCycleMath';

type State =
  | { status: 'idle' | 'loading' }
  | { status: 'empty' }
  | { status: 'error'; error: string }
  | { status: 'ready'; completedAt?: Date | null; cycleId: string; summary: LastCycleSummary; rawItems: CycleItemLike[] };

const CYCLE_COLLECTION_CANDIDATES = ['cycles', 'stockCycles', 'stock_takes'];

export function useLastCycleSummary(venueId: string | undefined, opts?: { topN?: number }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const db = getFirestore();
  const topN = opts?.topN ?? 10;

  useEffect(() => {
    if (!venueId) {
      setState({ status: 'error', error: 'Missing venueId' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setState({ status: 'loading' });

        // 1) Find the most recent completed cycle
        let cycleDoc: { id: string; completedAt?: Date | null } | null = null;
        let cycleCollName: string | null = null;

        for (const collName of CYCLE_COLLECTION_CANDIDATES) {
          const collRef = collection(db, 'venues', venueId, collName);
          try {
            const q1 = query(
              collRef,
              where('status', '==', 'completed'),
              orderBy('completedAt', 'desc'),
              limit(1),
            );
            const snap = await getDocs(q1);
            if (!snap.empty) {
              const docSnap = snap.docs[0];
              const data = docSnap.data() as any;
              cycleDoc = {
                id: docSnap.id,
                completedAt: data?.completedAt?.toDate?.() ?? (data?.completedAt ? new Date(data.completedAt) : null),
              };
              cycleCollName = collName;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!cycleDoc || !cycleCollName) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }

        // 2) Read items for that cycle in one go
        const itemsRef = collection(db, 'venues', venueId, cycleCollName, cycleDoc.id, 'items');
        const itemsSnap = await getDocs(itemsRef);

        const items: CycleItemLike[] = itemsSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data?.name,
            count: data?.count ?? data?.quantity ?? data?.qty,
            par: data?.par ?? data?.parLevel,
            costPrice: data?.costPrice ?? data?.price,
          };
        });

        const summary = computeLastCycleSummary(items, topN);
        if (!cancelled) {
          setState({
            status: 'ready',
            cycleId: cycleDoc.id,
            completedAt: cycleDoc.completedAt ?? null,
            summary,
            rawItems: items,
          });
        }
      } catch (e: any) {
        if (!cancelled) setState({ status: 'error', error: e?.message ?? 'Unknown error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [venueId, db, topN]);

  return useMemo(() => state, [state]);
}
