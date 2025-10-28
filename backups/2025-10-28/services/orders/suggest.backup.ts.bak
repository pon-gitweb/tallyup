// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const dlog = (...a:any[]) => console.log('[SuggestedOrders]', ...a);

function n(v:any,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v:any,d=''){ return (typeof v==='string' && v.trim().length)?v.trim():d; }
function uniq<T>(arr:T[]){ return Array.from(new Set(arr)); }

/** Public types used by other modules */
export type SuggestedLine = {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number | null;
  packSize: number | null;

  // Flags expected by downstream code
  cost?: number | null;          // alias for unitCost (kept for callers)
  needsPar?: boolean;            // true if PAR was missing (we defaulted)
  needsSupplier?: boolean;       // true if no preferred supplier was found
  reason?: string | null;        // human hint why it needs attention

  // NEW: which departments this product appears in (by dept doc id)
  deptIds?: string[];
};

export type SuggestedLegacyMap = {
  buckets: Record<string, { supplierName?: string; lines: SuggestedLine[] }>;
  unassigned: { lines: SuggestedLine[] };
  _meta?: { baselineCompletedAt?: number|null; reason?: string|null } | {};
};

async function getLatestCompletedAt(db:any, venueId:string): Promise<number|null> {
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  let newest: number | null = null;
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    areasSnap.forEach(a => {
      const data:any = a.data() || {};
      const c = data?.completedAt;
      if (c && typeof c.toMillis === 'function') {
        const ms = c.toMillis();
        if (newest==null || ms>newest) newest = ms;
      }
    });
  }
  return newest;
}

/**
 * Build Suggested Orders in-memory from Products + latest stock counts.
 * - If product.par is missing, we use defaultParIfMissing and mark needsPar=true
 * - If product has no supplierId, we place it into unassigned and mark needsSupplier=true
 * - Each line carries `cost` (alias of unitCost) for older callers
 * - NEW: Each line carries deptIds[] (departments where this product appears in areas)
 */
export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = { roundToPack: true, defaultParIfMissing: 6 }
): Promise<SuggestedLegacyMap> {
  dlog('ENTER buildSuggestedOrdersInMemory', { venueId, opts });
  const db = getFirestore(getApp());
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // 1) supplier names
  dlog('reading suppliers');
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string,string> = {};
  suppliersSnap.forEach(d => { supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier'); });

  // 2) products (for PAR and supplier link)
  dlog('reading products');
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const prodMeta: Record<string,{ par?:number; supplierId?:string; supplierName?:string; packSize?:number|null; cost?:number; name?:string }> = {};
  productsSnap.forEach(d => {
    const v:any = d.data() || {};
    const sid = v?.supplierId || v?.supplier?.id || undefined;
    const sname = v?.supplierName || v?.supplier?.name || (sid ? supplierNameById[sid] : undefined);
    prodMeta[d.id] = {
      name: s(v?.name, String(d.id)),
      par: Number.isFinite(v?.par) ? Number(v.par) : (Number.isFinite(v?.parLevel) ? Number(v.parLevel) : undefined),
      supplierId: sid,
      supplierName: sname,
      packSize: Number.isFinite(v?.packSize) ? Number(v.packSize) : null,
      cost: Number(v?.costPrice ?? v?.price ?? v?.unitCost ?? 0) || 0,
    };
  });

  // 3) latest counts by product (sum across all areas) + track which departments each product appears in
  dlog('reading departments/areas/items');
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const onHandByProduct: Record<string, number> = {};
  const productDeptSet: Record<string, Set<string>> = {}; // pid -> set of deptIds

  for (const dep of depsSnap.docs) {
    const depId = dep.id;
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas', area.id, 'items'));
      itemsSnap.forEach(it => {
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        const qty = n(v?.lastCount, 0);
        onHandByProduct[pid] = (onHandByProduct[pid] || 0) + qty;

        if (!productDeptSet[pid]) productDeptSet[pid] = new Set<string>();
        productDeptSet[pid].add(depId);
      });
    }
  }
  dlog('countedProductIds', { count: Object.keys(onHandByProduct).length });

  // 4) build suggestions
  const buckets: Record<string,{ supplierName?:string; lines: SuggestedLine[] }> = {};
  const unassigned: { lines: SuggestedLine[] } = { lines: [] };

  Object.keys(onHandByProduct).forEach(pid => {
    const meta = prodMeta[pid] || {};
    const name = s(meta.name, pid);
    const parFromDoc = Number.isFinite(meta.par) ? Number(meta.par) : undefined;
    const usedPar = parFromDoc ?? defaultPar;
    const onHand = n(onHandByProduct[pid], 0);
    const needed = Math.max(0, usedPar - onHand);
    if (needed <= 0) return;

    const sid = s(meta.supplierId || '');
    const sname = s(meta.supplierName || (sid ? supplierNameById[sid] : ''), 'Supplier');
    const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
    const cost = n(meta.cost, 0);

    const qty = roundToPack && pack && pack>0 ? Math.ceil(needed / pack) * pack : Math.round(needed);

    const deptIds = Array.from(productDeptSet[pid] || new Set<string>());

    const baseLine: SuggestedLine = {
      productId: pid,
      productName: name,
      qty: qty > 0 ? qty : 0,
      unitCost: cost > 0 ? cost : null,
      packSize: pack,
      cost: cost > 0 ? cost : null,                               // alias for callers
      needsPar: parFromDoc == null,                               // flag if we used defaultPar
      needsSupplier: !sid,                                        // flag if no supplier
      reason: !sid ? 'No preferred supplier set'
            : (parFromDoc == null ? `PAR missing; used default ${usedPar}` : null),
      // NEW
      deptIds,
    };

    if (!sid) {
      unassigned.lines.push(baseLine);
    } else {
      if (!buckets[sid]) buckets[sid] = { supplierName: sname, lines: [] };
      const exists = new Set((buckets[sid].lines||[]).map((x:any)=>String(x.productId)));
      if (!exists.has(pid)) buckets[sid].lines.push(baseLine);
    }
  });

  // Deduplicate and drop zero-qty lines
  Object.keys(buckets).forEach(sid => {
    const seen = new Set<string>();
    buckets[sid].lines = (buckets[sid].lines || []).filter((l:any)=>{
      if (seen.has(l.productId)) return false;
      seen.add(l.productId);
      return l.qty>0;
    });
  });
  unassigned.lines = unassigned.lines.filter((l:any)=>l?.qty>0);

  const suppliersWithLines = Object.values(buckets).filter(b=> (b.lines||[]).length>0).length + (unassigned.lines.length>0?1:0);
  const totalLines = Object.values(buckets).reduce((a,b)=>a+(b.lines?.length||0),0) + unassigned.lines.length;

  dlog('summary', { suppliersWithLines, totalLines });

  return {
    buckets,
    unassigned,
    _meta: {},   // no undefined symbol
  };
}
