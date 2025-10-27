// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const dlog = (...a:any[]) => console.log('[SuggestedOrders]', ...a);
const n = (v:any,d=0)=>{ const x=Number(v); return Number.isFinite(x)?x:d; };
const s = (v:any,d='')=> (typeof v==='string' && v.trim().length)?v.trim():d;
const uniq = <T,>(arr:T[]) => Array.from(new Set(arr));

export type SuggestedLine = {
  productId: string;
  productName?: string | null;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;

  // flags/fields expected by callers
  cost?: number | null;           // alias for unitCost
  needsPar?: boolean;             // true when PAR is missing (we used default)
  needsSupplier?: boolean;        // true when no supplierId
  reason?: string | null;         // hint for why flagged
};

export type SuggestedLegacyMap = {
  buckets: Record<string, { supplierName?: string; lines: SuggestedLine[] }>;
  unassigned: { lines: SuggestedLine[] };
  _meta?: { baselineCompletedAt?: number|string|null; reason?: string };
};

export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = { roundToPack: true, defaultParIfMissing: 6 }
): Promise<SuggestedLegacyMap> {
  dlog('ENTER buildSuggestedOrdersInMemory', { venueId, opts });
  const db = getFirestore(getApp());
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // suppliers
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string,string> = {};
  suppliersSnap.forEach(d => { supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier'); });

  // products metadata
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const prodMeta: Record<string,{ par?:number|null; supplierId?:string|null; supplierName?:string|null; packSize?:number|null; cost?:number|null; name?:string|null }> = {};
  productsSnap.forEach(d => {
    const v:any = d.data() || {};
    const sid = v?.supplierId || v?.supplier?.id || null;
    const sname = v?.supplierName || v?.supplier?.name || (sid ? supplierNameById[sid] : null);
    prodMeta[d.id] = {
      name: s(v?.name||d.id, d.id),
      par: Number.isFinite(v?.par) ? Number(v.par) : (Number.isFinite(v?.parLevel) ? Number(v.parLevel) : null),
      supplierId: sid ?? null,
      supplierName: sname ?? null,
      packSize: Number.isFinite(v?.packSize) ? Number(v.packSize) : null,
      cost: Number(v?.costPrice ?? v?.price ?? v?.unitCost ?? 0) || null,
    };
  });

  // stock on hand (latest known count)
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const onHandByProduct: Record<string, number> = {};
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      itemsSnap.forEach(it => {
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        onHandByProduct[pid] = (onHandByProduct[pid] || 0) + n(v?.lastCount, 0);
      });
    }
  }

  // build suggestions
  const buckets: SuggestedLegacyMap['buckets'] = {};
  const unassigned: SuggestedLegacyMap['unassigned'] = { lines: [] };

  Object.keys(onHandByProduct).forEach(pid => {
    const meta = prodMeta[pid] || {};
    const par = Number.isFinite(meta.par as any) ? Number(meta.par) : defaultPar;
    const parMissing = !(Number.isFinite(meta.par as any));
    const onHand = n(onHandByProduct[pid], 0);
    const needed = Math.max(0, par - onHand);
    if (needed <= 0) return;

    const sid = s(meta.supplierId || '');
    const sname = s(meta.supplierName || (sid ? supplierNameById[sid] : ''));
    const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
    const cost = n(meta.cost, 0) || null;

    const qty = roundToPack && pack && pack>0 ? Math.ceil(needed / pack) * pack : Math.round(needed);

    const line: SuggestedLine = {
      productId: pid,
      productName: meta.name || pid,
      qty: qty > 0 ? qty : 0,
      unitCost: cost,
      packSize: pack,

      // compatibility fields:
      cost: cost,
      needsPar: !!parMissing,
      needsSupplier: !sid,
      reason: parMissing ? 'Missing PAR' : (!sid ? 'Missing supplier' : null),
    };

    if (!sid) {
      unassigned.lines.push(line);
    } else {
      if (!buckets[sid]) buckets[sid] = { supplierName: sname || sid, lines: [] };
      const exists = new Set((buckets[sid].lines||[]).map((x:any)=>String(x.productId)));
      if (!exists.has(pid)) buckets[sid].lines.push(line);
    }
  });

  // final tidy
  Object.keys(buckets).forEach(sid => {
    const seen = new Set<string>();
    buckets[sid].lines = (buckets[sid].lines || []).filter((l:any)=>{
      if (seen.has(l.productId)) return false;
      seen.add(l.productId);
      return l.qty>0;
    });
  });
  unassigned.lines = unassigned.lines.filter((l:any)=>l?.qty>0);

  return {
    buckets,
    unassigned,
    _meta: { baselineCompletedAt: null, reason: null },
  };
}

export default { buildSuggestedOrdersInMemory };
