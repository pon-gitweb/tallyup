import { useEffect, useState } from 'react';
import { collection, getFirestore, getDocs, limit, orderBy, query, startAt, endAt } from 'firebase/firestore';
import { getApp } from 'firebase/app';

export type ProductHit = {
  id: string;
  name: string;
  packSize?: number|null;
  packUnit?: 'ml'|'L'|'g'|'kg'|'each'|string|null;
  packPrice?: number|null;
  thumbUrl?: string|null;
  supplierName?: string|null;
};

export function useProductSearch(venueId: string|undefined, term: string, max: number = 20) {
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!venueId || !term?.trim()) { setHits([]); return; }
      setLoading(true);
      try {
        const db = getFirestore(getApp());
        const col = collection(db, 'venues', venueId, 'products');
        const q = query(col, orderBy('name'), startAt(term), endAt(term + '\uf8ff'), limit(max));
        const snap = await getDocs(q);
        if (cancelled) return;
        const list: ProductHit[] = [];
        snap.forEach(d => {
          const x:any = d.data() || {};
          list.push({
            id: d.id,
            name: x.name ?? '(unnamed)',
            packSize: x.packSize ?? x.pack?.size ?? null,
            packUnit: x.packUnit ?? x.pack?.unit ?? null,
            packPrice: x.packPrice ?? x.price ?? null,
            thumbUrl: x.thumbUrl ?? x.imageUrl ?? null,
            supplierName: x.supplierName ?? null
          });
        });
        setHits(list);
      } catch {
        setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, term, max]);

  return { hits, loading };
}
