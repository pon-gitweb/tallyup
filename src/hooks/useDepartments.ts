import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase';

export type Dept = { id: string; name: string };

export function useDepartments(venueId?: string | null) {
  const [items, setItems] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, 'venues', venueId, 'departments'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const out: Dept[] = [];
      snap.forEach(d => out.push({ id: d.id, name: (d.data() as any)?.name || 'Department' }));
      setItems(out);
      setLoading(false);
    }, () => { setItems([]); setLoading(false); });
    return () => unsub();
  }, [venueId]);

  return { items, loading };
}
