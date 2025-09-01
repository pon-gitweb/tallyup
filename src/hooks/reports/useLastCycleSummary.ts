import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

export type LastCycleSummaryData = {
  departments: number;
  areasTotal: number;
  areasCompleted: number;
  areasInProgress: number;
  sessionStatus: 'active' | 'idle' | null;
};

type HookState = {
  loading: boolean;
  data: LastCycleSummaryData;
  error: string | null;
  refresh: () => void;
  generateNow: () => Promise<void>;
};

export function useLastCycleSummary(): HookState {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LastCycleSummaryData>({
    departments: 0,
    areasTotal: 0,
    areasCompleted: 0,
    areasInProgress: 0,
    sessionStatus: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  async function compute() {
    if (!venueId) {
      setData({ departments: 0, areasTotal: 0, areasCompleted: 0, areasInProgress: 0, sessionStatus: null });
      return;
    }

    // departments
    const deptCol = collection(db, 'venues', venueId, 'departments');
    const deptSnap = await getDocs(deptCol);

    let departments = 0;
    let areasTotal = 0;
    let areasCompleted = 0;
    let areasInProgress = 0;

    for (const d of deptSnap.docs) {
      departments += 1;
      const areasCol = collection(db, 'venues', venueId, 'departments', d.id, 'areas');
      const areasSnap = await getDocs(areasCol);
      areasTotal += areasSnap.size;

      areasSnap.forEach(a => {
        const v = a.data() as any;
        const startedAt = v?.startedAt ?? null;
        const completedAt = v?.completedAt ?? null;
        if (completedAt) areasCompleted += 1;
        else if (startedAt && !completedAt) areasInProgress += 1;
      });
    }

    const sessionStatus: 'active' | 'idle' | null =
      areasInProgress > 0 ? 'active' :
      areasCompleted > 0 ? 'idle' : null;

    const next = { departments, areasTotal, areasCompleted, areasInProgress, sessionStatus };
    console.log('[TallyUp Reports] LastCycleSummary', JSON.stringify({ venueId, ...next }));
    setData(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await compute();
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load summary');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, nonce]);

  const refresh = () => setNonce(n => n + 1);
  const generateNow = async () => { await compute(); };

  return useMemo(() => ({ loading, data, error, refresh, generateNow }), [loading, data, error]);
}

// also provide default export for flexibility
export default useLastCycleSummary;
