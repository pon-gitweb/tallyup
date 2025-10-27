// @ts-nocheck
import { getFirestore, collection, getDocs, query as fsQuery, where, orderBy, limit, documentId } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const dlog = (...a:any[]) => console.log('[SuggestedOrders]', ...a);

type SuggestedLegacyMap = {
  buckets: Record<string, { supplierName?: string; lines: any[] }>;
  unassigned: { lines: any[] };
  _meta?: { baselineCompletedAt?: number|string|null; reason?: string };
};

const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);

function n(v:any,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v:any,d=''){ return (typeof v==='string' && v.trim().length)?v.trim():d; }
function m1(v:any){ const x = Math.round(n(v,0)); return x>0?x:1; }
function uniq<T>(arr:T[]){ return Array.from(new Set(arr)); }

async function getLatestCompletedAt(db:any, venueId:string): Promise<number|null> {
  // Query across departments/*/areas/* for the most recent completedAt
  // We’ll scan a few departments for simplicity; if you keep a top-level stockTakes collection, prefer that.
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

export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = { roundToPack: true, defaultParIfMissing: 6 }
): Promise<SuggestedLegacyMap> {
  dlog('ENTER buildSuggestedOrdersInMemory', { venueId, opts });
  const db = getFirestore(getApp());
  const baselineMs = await getLatestCompletedAt(db, venueId);
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // 1) supplier names
  dlog('reading query suppliers.list');
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string,string> = {};
  suppliersSnap.forEach(d => { supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier'); });

  // 2) products (for PAR and supplier link)
  dlog('reading query products.list');
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const prodMeta: Record<string,{ par?:number; supplierId?:string; supplierName?:string; packSize?:number|null; cost?:number }> = {};
  const prodNameById: Record<string,string> = {};
  productsSnap.forEach(d => {
    const v:any = d.data() || {};
    const sid = v?.supplierId || v?.supplier?.id || undefined;
    const sname = v?.supplierName || v?.supplier?.name || (sid ? supplierNameById[sid] : undefined);
    prodMeta[d.id] = {
      par: Number.isFinite(v?.par) ? Number(v.par) : (Number.isFinite(v?.parLevel) ? Number(v.parLevel) : undefined),
      supplierId: sid,
      supplierName: sname,
      packSize: Number.isFinite(v?.packSize) ? Number(v.packSize) : null,
      cost: Number(v?.costPrice ?? v?.price ?? v?.unitCost ?? 0) || 0,
    };
    prodNameById[d.id] = (typeof v?.name === 'string' && v.name.trim().length) ? v.name.trim() : String(d.id);
  });
  dlog('reading query departments.list');
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  const onHandByProduct: Record<string, number> = {};
  for (const dep of depsSnap.docs) {
    dlog('reading query areas.list');
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areasSnap.docs) {
      dlog('reading query area.items.list');
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      itemsSnap.forEach(it => {
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        // Optional filter: only counts from/around the baseline stocktake.
        // We accept any lastCount present; if you want to be strict, uncomment the next 3 lines.
        // const lca = v?.lastCountAt;
        // if (baselineMs && lca?.toMillis && lca.toMillis() < baselineMs - 60*60*1000) return; // older than baseline
        // if (baselineMs && lca?.toMillis && lca.toMillis() > baselineMs + 24*60*60*1000) return; // clearly after
        const qty = n(v?.lastCount, 0);
        onHandByProduct[pid] = (onHandByProduct[pid] || 0) + qty;
      });
    }
  }

  dlog('countedProductIds', { count: Object.keys(onHandByProduct).length });

  // 5) build suggestions: need = max(0, PAR - onHand)
  const buckets: Record<string,{ supplierName?:string; lines:any[] }> = {};
  const unassigned: { lines:any[] } = { lines: [] };

  Object.keys(onHandByProduct).forEach(pid => {
    const meta = prodMeta[pid] || {};
    const par = Number.isFinite(meta.par) ? Number(meta.par) : defaultPar;
    const onHand = n(onHandByProduct[pid], 0);
    const needed = Math.max(0, par - onHand);
    if (needed <= 0) return; // nothing to suggest for this product

    const sid = s(meta.supplierId || '');
    const sname = s(meta.supplierName || (sid ? supplierNameById[sid] : ''), 'Supplier');
    const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
    const cost = n(meta.cost, 0);

    const qty = roundToPack && pack && pack>0 ? Math.ceil(needed / pack) * pack : Math.round(needed);

   const line = {
  productId: pid,
  productName: prodNameById[pid] ?? pid, // <-- use the map, never .get()
  qty: qty > 0 ? qty : 0,
  unitCost: cost > 0 ? cost : null,
  packSize: pack,
};

    if (!sid) {
      unassigned.lines.push(line);
    } else {
      if (!buckets[sid]) buckets[sid] = { supplierName: sname, lines: [] };
      const exists = new Set((buckets[sid].lines||[]).map((x:any)=>String(x.productId)));
      if (!exists.has(pid)) buckets[sid].lines.push(line);
    }
  });

  // 6) tidy up
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
  dlog('perSupplierCounts', Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k, v.lines.length])).concat([['unassigned', unassigned.lines.length]]));

  return {
    buckets,
    unassigned,
    _meta: { baselineCompletedAt: (typeof baselineMs !== 'undefined' ? baselineMs : null), reason: 'latest areas.completedAt scan' }
  };
}
