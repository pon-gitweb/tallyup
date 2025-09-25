import { useEffect, useState } from 'react';
import { Unsubscribe, onSnapshot, Query, DocumentReference, QuerySnapshot, DocumentSnapshot } from 'firebase/firestore';
import { useVenueId, safeAttach } from '../context/VenueProvider';

/**
 * Guarded collection listener:
 *   const { data, loading, error } = useGuardedCollection(q);
 * It won't attach until venueId is available (prevents permission-denied on foreign venue).
 */
export function useGuardedCollection<T = any>(queryBuilder: (venueId: string) => Query<T> | null) {
  const venueId = useVenueId();
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsub: Unsubscribe | void;
    setLoading(true);
    setError(null);
    setData(null);

    unsub = safeAttach(venueId, () => {
      const q = venueId ? queryBuilder(venueId) : null;
      if (!q) { setLoading(false); return; }
      return onSnapshot(q, (snap: QuerySnapshot<T>) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
        setData(rows);
        setLoading(false);
      }, (err) => {
        setError(err);
        setLoading(false);
        console.log('[TallyUp Guard] collection error', JSON.stringify({ code: (err as any)?.code, message: err.message }));
      });
    });

    return () => { if (unsub) unsub(); };
  }, [venueId, queryBuilder]);

  return { data, loading, error, venueId };
}

/**
 * Guarded document listener:
 *   const { data, loading, error } = useGuardedDoc(refBuilder);
 */
export function useGuardedDoc<T = any>(refBuilder: (venueId: string) => DocumentReference<T> | null) {
  const venueId = useVenueId();
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsub: Unsubscribe | void;
    setLoading(true);
    setError(null);
    setData(null);

    unsub = safeAttach(venueId, () => {
      const ref = venueId ? refBuilder(venueId) : null;
      if (!ref) { setLoading(false); return; }
      return onSnapshot(ref, (snap: DocumentSnapshot<T>) => {
        setData(snap.exists() ? ({ id: snap.id, ...(snap.data() as any) }) : null);
        setLoading(false);
      }, (err) => {
        setError(err);
        setLoading(false);
        console.log('[TallyUp Guard] doc error', JSON.stringify({ code: (err as any)?.code, message: err.message }));
      });
    });

    return () => { if (unsub) unsub(); };
  }, [venueId, refBuilder]);

  return { data, loading, error, venueId };
}
