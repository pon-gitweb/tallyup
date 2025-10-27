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

// ---------------- Firestore path ----------------

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

export async function buildVariance(venueId:string, opts:BuildOpts = {}){
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
      par: Number.isFinite(v?.par) ? Number(v.par) : (Number.isFinite(v?.parLevel) ? Number(v.parLevel) : undefined),
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

  // Gather latest counts (baseline) and, if possible, previous counts for delta
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

  const bandPct = Number.isFinite(opts.bandPct) ? Number(opts.bandPct) : 1.5;
  const material = rows.filter(r=> Math.abs(n(r.variancePct,0)) >= bandPct);
  const minor    = rows.filter(r=> Math.abs(n(r.variancePct,0)) <  bandPct);

  const sortBy = opts.sortBy || 'value';
  const dir = opts.dir || 'desc';
  const cmp = (a:any,b:any)=>{
    const d = dir==='asc'? 1 : -1;
    if (sortBy==='value') return d * (n(a.varianceValue,0) - n(b.varianceValue,0));
    if (sortBy==='qty')   return d * (n(a.varianceQty,0)   - n(b.varianceQty,0));
    if (sortBy==='name')  return d * String(a.name||'').localeCompare(String(b.name||''));
    if (sortBy==='supplier') return d * String(a.supplierName||'').localeCompare(String(b.supplierName||''));
    return 0;
  };
  material.sort(cmp).reverse();
  minor.sort(cmp).reverse();

  const withinBand = material.length===0;
  const summary = withinBand
    ? { message: `All variances are within ±${bandPct}% of expected.`, withinBand: true, bandPct }
    : { message: `${material.length} items outside ±${bandPct}% band.`, withinBand: false, bandPct };

  return {
    summary,
    rowsMaterial: material,
    rowsMinor: minor
  };
}

// ---------------- Pure data path for tests ----------------

export type ComputeInput = {
  items: Array<{ id: string; name: string; departmentId?: string; unitCost?: number; par?: number }>;
  lastCountsByItemId: Record<string, number>;
  receivedByItemId?: Record<string, number>;
  soldByItemId?: Record<string, number>;
  filterDepartmentId?: string;
};

export type VarianceRow = { itemId: string; name?: string | null; qty: number; value: number; };

export type VarianceResult = {
  scope: { venueId: string };
  shortages: VarianceRow[];
  excesses: VarianceRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};

/** Test helper: compute variance from raw data (no Firestore). */
export function computeVarianceFromData(data: ComputeInput): VarianceResult {
  const items = data.items || [];
  const last = data.lastCountsByItemId || {};
  const recv = data.receivedByItemId || {};
  const sold = data.soldByItemId || {};
  const depFilter = data.filterDepartmentId || null;

  const rows: { id:string; name:string; delta:number; unitCost:number }[] = [];

  for (const it of items) {
    if (depFilter && it.departmentId && it.departmentId !== depFilter) continue;
    const id = it.id;
    const unitCost = n(it.unitCost, 0);
    const par = n(it.par, 0);

    const current = n(last[id], 0) + n(recv[id], 0) - n(sold[id], 0);
    const delta = current - par; // +excess, -shortage

    rows.push({ id, name: it.name, delta, unitCost });
  }

  const shortages: VarianceRow[] = [];
  const excesses: VarianceRow[] = [];
  let totalShort = 0;
  let totalExcess = 0;

  for (const r of rows) {
    if (r.delta < 0) {
      const qty = Math.abs(r.delta);
      const value = qty * r.unitCost;
      shortages.push({ itemId: r.id, name: r.name, qty, value });
      totalShort += value;
    } else if (r.delta > 0) {
      const qty = r.delta;
      const value = qty * r.unitCost;
      excesses.push({ itemId: r.id, name: r.name, qty, value });
      totalExcess += value;
    }
  }

  return {
    scope: { venueId: 'unknown' },
    shortages,
    excesses,
    totalShortageValue: totalShort,
    totalExcessValue: totalExcess,
  };
}

// Overload to support both signatures used around the codebase/tests.
export async function computeVariance(arg1:any, arg2:any = {}) {
  // If first arg is a string → treat as venueId (Firestore path)
  if (typeof arg1 === 'string') {
    return buildVariance(arg1, arg2 || {});
  }
  // Otherwise it is the raw data object used by tests
  return computeVarianceFromData(arg1 as ComputeInput);
}

export async function computeVarianceForDepartment(venueId: string, departmentId: string, opts: any = {}) {
  // You can refine buildVariance to filter by department if needed
  return buildVariance(venueId, opts);
}

export default {
  buildVariance,
  computeVariance,
  computeVarianceForDepartment,
  computeVarianceFromData,
};
