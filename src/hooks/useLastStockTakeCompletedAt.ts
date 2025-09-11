import { useEffect, useState } from 'react';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  Timestamp,
} from 'firebase/firestore';

type Result = {
  loading: boolean;
  error?: string;
  completedAt: Timestamp | null;
};

/**
 * Venue-scoped latest stock-take completion time (no collectionGroup).
 * Assumptions:
 * - venues/{venueId}/sessions/{sessionId}: { isFullTakeComplete?: boolean, completedAt?: Timestamp }
 * - Fallback: venues/{venueId}/departments/*/areas/* may carry { completedAt?: Timestamp }
 */
export function useLastStockTakeCompletedAt(venueId?: string | null): Result {
  const [state, setState] = useState<Result>({ loading: !!venueId, completedAt: null });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!venueId) {
        setState({ loading: false, completedAt: null });
        return;
      }
      setState({ loading: true, completedAt: null });

      try {
        const db = getFirestore(getApp());
        let latest: Timestamp | null = null;

        // 1) Prefer finalized sessions
        const sessionsSnap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
        sessionsSnap.forEach((s) => {
          const d = s.data() as any;
          if (d?.isFullTakeComplete && d?.completedAt instanceof Timestamp) {
            if (!latest || d.completedAt.toMillis() > latest.toMillis()) latest = d.completedAt;
          }
        });

        // 2) Fallback: area-level completedAt
        if (!latest) {
          const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
          for (const dep of depsSnap.docs) {
            const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
            areasSnap.forEach((a) => {
              const ad = a.data() as any;
              if (ad?.completedAt instanceof Timestamp) {
                if (!latest || ad.completedAt.toMillis() > latest.toMillis()) latest = ad.completedAt;
              }
            });
          }
        }

        if (!cancelled) setState({ loading: false, completedAt: latest || null });
      } catch (e: any) {
        if (!cancelled) setState({ loading: false, completedAt: null, error: String(e?.message || e) });
      }
    }
    run();
    return () => { cancelled = true; };
  }, [venueId]);

  return state;
}
