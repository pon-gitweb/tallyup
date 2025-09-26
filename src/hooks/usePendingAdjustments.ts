import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export function usePendingAdjustmentsCount(venueId?: string | null) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) { setCount(0); setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'venues', venueId, 'sessions'),
      where('type', '==', 'stock-adjustment-request'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snap) => {
      setCount(snap.size || 0);
      setLoading(false);
    }, () => {
      setCount(0);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  return { count, loading };
}
