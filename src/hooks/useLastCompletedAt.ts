import { useEffect, useState } from 'react';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  Timestamp,
} from 'firebase/firestore';

type Result = { loading: boolean; ts: Timestamp | null; error?: string };

export default function useLastCompletedAt(venueId?: string | null): Result {
  const [state, setState] = useState<Result>({ loading: !!venueId, ts: null });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!venueId) { setState({ loading: false, ts: null }); return; }
      setState({ loading: true, ts: null });
      try {
        const db = getFirestore(getApp());
        let latest: Timestamp | null = null;

        // Prefer sessions with isFullTakeComplete
        const sessions = await getDocs(collection(db, 'venues', venueId, 'sessions'));
        sessions.forEach(s => {
          const d = s.data() as any;
          if (d?.isFullTakeComplete && d?.completedAt instanceof Timestamp) {
            if (!latest || d.completedAt.toMillis() > latest.toMillis()) latest = d.completedAt;
          }
        });

        // Fallback: newest area.completedAt across departments
        if (!latest) {
          const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
          for (const dep of deps.docs) {
            const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
            areas.forEach(a => {
              const ad = a.data() as any;
              if (ad?.completedAt instanceof Timestamp) {
                if (!latest || ad.completedAt.toMillis() > latest.toMillis()) latest = ad.completedAt;
              }
            });
          }
        }

        if (!cancelled) setState({ loading: false, ts: latest || null });
      } catch (e: any) {
        if (!cancelled) setState({ loading: false, ts: null, error: String(e?.message || e) });
      }
    }
    run();
    return () => { cancelled = true; };
  }, [venueId]);

  return state;
}
