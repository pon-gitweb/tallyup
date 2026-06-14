import { useState, useEffect } from 'react';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { useVenueId } from '../context/VenueProvider';

export function useIsActivated() {
  const venueId = useVenueId();
  const [activated, setActivated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) {
      setActivated(false);
      setLoading(false);
      return;
    }

    const db = getFirestore();
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        setActivated(snap.data()?.activated === true);
        setLoading(false);
      },
      (err) => {
        console.error('[useIsActivated]', err);
        setActivated(false);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [venueId]);

  return { activated, loading };
}
