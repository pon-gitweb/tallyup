import { useEffect, useMemo, useState } from 'react';
import { listSupplierItems, chooseCheapest, CatalogItem } from '../services/catalog/globalCatalog';
import { norm, normSize } from '../services/catalog/normalize';

const DEFAULT_SUPPLIERS = ['tickety-boo','premium-liquor','nicely-done','no-8-distillery','master-fm-co','alchemy-tonic'];

export function useCheapestForProduct(productName: string, productSize?: string | null, supplierSlugs = DEFAULT_SUPPLIERS) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const all: CatalogItem[] = [];
        for (const slug of supplierSlugs) {
          const rows = await listSupplierItems(slug);
          if (!alive) return;
          all.push(...rows);
        }
        setItems(all);
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supplierSlugs.join('|')]);

  const matchName = norm(productName);
  const matchSize = productSize ? normSize(productSize) : null;

  const candidates = useMemo(() => {
    const nameEq = (n?: string) => norm(n) === matchName;
    const sizeEq = (s?: string) => (matchSize ? normSize(s) === matchSize : true);
    return items.filter(i => nameEq(i.name) && sizeEq(i.size));
  }, [items, matchName, matchSize]);

  const cheapest = useMemo(() => chooseCheapest(candidates), [candidates]);

  return { loading, error, candidates, cheapest };
}
