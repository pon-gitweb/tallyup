// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const vlog = (...a:any[]) => console.log('[Variance]', ...a);

function n(v:any,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v:any,d=''){ return (typeof v==='string' && v.trim().length)?v.trim():d; }

type BuildOpts = {
  bandPct?: number;        // default 1.5
  sortBy?: 'value'|'qty'|'name'|'supplier';
  dir?: 'asc'|'desc';
};

type LegacyItem = { id: string; name: string; departmentId?: string | null; unitCost?: number | null; par?: number | null };
type LegacyInput = {
  items: LegacyItem[];
  lastCountsByItemId: Record<string, number>;
  receivedByItemId?: Record<string, number>;
  soldByItemId?: Record<string, number>;
  filterDepartmentId?: string | null;
};
type LegacyRow = { itemId: string; name: string; qty: number; value: number };
type LegacyResult = {
  scope: { venueId: string };
  shortages: LegacyRow[];
  excesses:  LegacyRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};

type UIResult = {
  summary: { message: string; withinBand: boolean; bandPct: number };
  rowsMaterial: any[];
  rowsMinor: any[];
};

// ---------- Firestore helpers for async UI path ----------
async function getLatestCompletedAt(db:any, venueId:string): Promise<number|null> {
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  let newest: number | null = null;
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    areasSnap.forEach(a => {
      const data:any = a.data() || {};
      const c = data?.completedAt;
      if (c?.toMillis) {
        const ms = c.toMillis();
        if (newest==null || ms>newest) newest = ms;
      }
    });
  }
  return newest;
}

// ---------- ASYNC (UI) PATH ----------
export async function buildVariance(venueId:string, opts:BuildOpts = {}): Promise<UIResult> {
  const db = getFirestore(getApp());
  const bandPct = Number.isFinite(opts.bandPct) ? Number(opts.bandPct) : 1.5;
  const sortBy = opts.sortBy || 'value';
  const dir = opts.dir || 'desc';

  // metadata sources
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const prodMeta: Record<string,{ name?:string; par?:number; supplierId?:string; supplierName?:string; cost?:number }> = {};
  productsSnap.forEach(d=>{
    const v:any = d.data() || {};
    prodMeta[d.id] = {
      name: s(v?.name, d.id),
      par: Number.isFinite(v?.par) ? Number(v.par) : undefined,
      supplierId: s(v?.supplierId || v?.supplier?.id || ''),
      supplierName: s(v?.supplierName || v?.supplier?.name || ''),
      cost: n(v?.costPrice ?? v?.price ?? v?.unitCost, 0)
    };
  });

  const baselineMs = await getLatestCompletedAt(db, venueId);
  if (!baselineMs) {
    return {
      summary: {
        message: 'No completed stocktake found yet. Complete a stocktake to see variances.',
        withinBand: true,
        bandPct
      },
      rowsMaterial: [],
      rowsMinor: []
    };
  }

  // Gather latest counts (baseline) and optional previous
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const latestByPid: Record<string, number> = {};
  const prevByPid: Record<string, number> = {};

  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      itemsSnap.forEach(it=>{
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        const lc = n(v?.lastCount, 0);
        latestByPid[pid] = (latestByPid[pid]||0) + lc;
        const lp = n(v?.prevCount ?? v?.previousCount, NaN);
        if (Number.isFinite(lp)) prevByPid[pid] = (prevByPid[pid]||0) + lp;
      });
    }
  }

  const rows:any[] = [];
  Object.keys(latestByPid).forEach(pid=>{
    const meta = prodMeta[pid] || {};
    const name = s(meta.name, pid);
    const supplierName = s(meta.supplierName, '');
    const par = Number.isFinite(meta.par) ? Number(meta.par) : undefined;
    const cost = n(meta.cost, 0);

    const latest = n(latestByPid[pid], 0);
    const prev = Number.isFinite(prevByPid[pid]) ? n(prevByPid[pid], 0) : (Number.isFinite(par)? n(par,0) : null);

    let varianceQty = 0;
    if (prev != null) {
      varianceQty = latest - prev;
    }
    const varianceValue = cost>0 ? varianceQty * cost : 0;
    const baseForPct = Math.max(1, (prev ?? par ?? latest) || 1);
    const variancePct = (varianceQty / baseForPct) * 100;

    rows.push({
      productId: pid,
      name,
      supplierName: supplierName || undefined,
      par: par ?? null,
      varianceQty,
      varianceValue,
      variancePct
    });
  });

  const bandPctVal = Number(bandPct);
  const material = rows.filter(r=> Math.abs(n(r.variancePct,0)) >= bandPctVal);
  const minor    = rows.filter(r=> Math.abs(n(r.variancePct,0)) <  bandPctVal);

  const dirMul = dir==='asc'? 1 : -1;
  const cmp = (a:any,b:any)=>{
    if ((opts.sortBy||'value')==='value') return dirMul * (n(a.varianceValue,0) - n(b.varianceValue,0));
    if (opts.sortBy==='qty')   return dirMul * (n(a.varianceQty,0)   - n(b.varianceQty,0));
    if (opts.sortBy==='name')  return dirMul * String(a.name||'').localeCompare(String(b.name||''));
    if (opts.sortBy==='supplier') return dirMul * String(a.supplierName||'').localeCompare(String(b.supplierName||''));
    return 0;
  };
  material.sort(cmp).reverse();
  minor.sort(cmp).reverse();

  const withinBand = material.length===0;
  const summary = withinBand
    ? { message: `All variances are within ±${bandPctVal}% of expected.`, withinBand: true, bandPct: bandPctVal }
    : { message: `${material.length} items outside ±${bandPctVal}% band.`, withinBand: false, bandPct: bandPctVal };

  return { summary, rowsMaterial: material, rowsMinor: minor };
}

// ---------- SYNC (TEST/LEGACY) PATH ----------
export function computeVarianceFromData(data: LegacyInput): LegacyResult {
  const items = Array.isArray(data?.items) ? data.items : [];
  const last  = data?.lastCountsByItemId || {};
  const rec   = data?.receivedByItemId   || {};
  const sold  = data?.soldByItemId       || {};
  const filterDept = data?.filterDepartmentId || null;

  const byId = new Map<string, LegacyItem>();
  for (const it of items) {
    if (filterDept && s(it.departmentId||'') !== filterDept) continue;
    byId.set(it.id, it);
  }

  const shortages: LegacyRow[] = [];
  const excesses:  LegacyRow[] = [];

  for (const [id, meta] of byId.entries()) {
    const name = meta.name;
    const unitCost = n(meta.unitCost, 0);
    const par = n(meta.par, 0);

    const onHand = n(last[id], 0) + n(rec[id], 0) - n(sold[id], 0);
    const delta = onHand - par;

    if (delta < 0) {
      const qty = Math.abs(delta);
      shortages.push({ itemId: id, name, qty, value: unitCost * qty });
    } else if (delta > 0) {
      const qty = delta;
      excesses.push({ itemId: id, name, qty, value: unitCost * qty });
    }
  }

  const totalShortageValue = shortages.reduce((a,r)=>a+n(r.value,0),0);
  const totalExcessValue   = excesses.reduce((a,r)=>a+n(r.value,0),0);

  return {
    scope: { venueId: 'unknown' },
    shortages,
    excesses,
    totalShortageValue,
    totalExcessValue,
  };
}

// ---------- OVERLOADS (both paths in one API) ----------
export function computeVariance(data: LegacyInput): LegacyResult;
export function computeVariance(venueId: string, opts?: any): Promise<UIResult>;
export function computeVariance(arg1: any, arg2?: any): any {
  // Data-object => sync legacy result
  if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
    return computeVarianceFromData(arg1 as LegacyInput);
  }
  // String venueId => async UI result
  return buildVariance(String(arg1), arg2 || {});
}

export async function computeVarianceForDepartment(
  venueId: string,
  departmentId: string,
  opts: any = {}
): Promise<UIResult> {
  // TODO: add department filtering inside buildVariance if you need it
  return buildVariance(venueId, opts);
}

export default {
  buildVariance,
  computeVariance,
  computeVarianceForDepartment,
  computeVarianceFromData,
};
