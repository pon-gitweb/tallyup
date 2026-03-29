import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export function usePendingBudgetApprovalsCount(venueId?: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!venueId) { setCount(0); return; }
    const q = query(
      collection(db, 'venues', venueId, 'sessions'),
      where('type', '==', 'budget-override-request'),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q, snap => setCount(snap.size), () => setCount(0));
    return () => unsub();
  }, [venueId]);
  return { count };
}
