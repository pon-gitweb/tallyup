// @ts-nocheck
/**
 * Variance service
 *
 * Compatibility goals:
 *  - Keep Firestore-based builders (buildVariance/computeVariance/computeVarianceForDepartment)
 *  - Provide a pure-data API: computeVarianceFromData(data)
 *  - Default export exposes all functions (so tests can do `variance.computeVarianceFromData(...)`)
 */

import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const vlog = (...a:any[]) => console.log('[Variance]', ...a);
const n = (v:any,d=0)=>{ const x=Number(v); return Number.isFinite(x)?x:d; };
const s = (v:any,d='')=> (typeof v==='string' && v.trim().length)?v.trim():d;

type BuildOpts = { bandPct?: number; sortBy?: 'value'|'qty'|'name'|'supplier'; dir?: 'asc'|'desc'; };

/** ---------- Firestore helpers (kept for app screens) ---------- */
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

/** ---------- Firestore-based builder (used by app UI) ---------- */
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
      par: Number.isFinite(v?.par) ? Number(v.par) : undefined,
      supplierId: s(v?.supplierId || v?.supplier?.id || ''),
      supplierName: s(v?.supplierName || v?.supplier?.name || ''),
      cost: n(v?.costPrice ?? v?.price ?? v?.unitCost, 0)
    };
  });

  const baselineMs = await getLatestCompletedAt(db, venueId);
  if (!baselineMs) {
    return { summary: { message: 'No completed stocktake found yet. Complete a stocktake to see variances.', withinBand: true, bandPct }, rowsMaterial: [], rowsMinor: [] };
  }

  // Latest counts only (best-effort)
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const latestByPid: Record<string, number> = {};
  for (const dep of depsSnap.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      itemsSnap.forEach(it=>{
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        latestByPid[pid] = (latestByPid[pid]||0) + n(v?.lastCount, 0);
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
    const prev = Number.isFinite(par)? n(par,0) : null;

    let varianceQty = 0;
    if (prev != null) varianceQty = latest - prev;
    const varianceValue = cost>0 ? varianceQty * cost : 0;
    const baseForPct = Math.max(1, (prev ?? latest) || 1);
    const variancePct = (varianceQty / baseForPct) * 100;

    rows.push({ productId: pid, name, supplierName: supplierName || undefined, par: par ?? null, varianceQty, varianceValue, variancePct });
  });

  const material = rows.filter(r=> Math.abs(n(r.variancePct,0)) >= (Number.isFinite(opts.bandPct)?opts.bandPct:1.5));
  const minor    = rows.filter(r=> Math.abs(n(r.variancePct,0)) <  (Number.isFinite(opts.bandPct)?opts.bandPct:1.5));

  const withinBand = material.length===0;
  const summary = withinBand
    ? { message: `All variances are within ±${Number.isFinite(opts.bandPct)?opts.bandPct:1.5}% of expected.`, withinBand: true, bandPct: Number.isFinite(opts.bandPct)?opts.bandPct:1.5 }
    : { message: `${material.length} items outside ±${Number.isFinite(opts.bandPct)?opts.bandPct:1.5}% band.`, withinBand: false, bandPct: Number.isFinite(opts.bandPct)?opts.bandPct:1.5 };

  return { summary, rowsMaterial: material, rowsMinor: minor };
}

export async function computeVariance(venueId: string, opts: any = {}) {
  return buildVariance(venueId, opts);
}

export async function computeVarianceForDepartment(venueId: string, departmentId: string, opts: any = {}) {
  return buildVariance(venueId, opts);
}

/** --------------------------------------------------------------------
 * 2) Pure-data API expected by tests: computeVarianceFromData(data)
 *    Input shape (from tests):
 *      {
 *        items: [{ id, name, departmentId, unitCost, par }],
 *        lastCountsByItemId: Record<id, number>,
 *        receivedByItemId:   Record<id, number>,
 *        soldByItemId:       Record<id, number>,
 *        filterDepartmentId: string
 *      }
 *    Output shape (legacy):
 *      {
 *        scope: { venueId: 'unknown' },
 *        shortages: Array<{ itemId, name, qty, value }>,
 *        excesses:  Array<{ itemId, name, qty, value }>,
 *        totalShortageValue: number,
 *        totalExcessValue: number
 *      }
 * -------------------------------------------------------------------- */
export function computeVarianceFromData(data: {
  items: Array<{ id: string; name: string; departmentId?: string|null; unitCost?: number|null; par?: number|null }>;
  lastCountsByItemId: Record<string, number>;
  receivedByItemId?: Record<string, number>;
  soldByItemId?: Record<string, number>;
  filterDepartmentId?: string|null;
}) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const last  = data?.lastCountsByItemId || {};
  const rec   = data?.receivedByItemId || {};
  const sold  = data?.soldByItemId || {};
  const filterDep = data?.filterDepartmentId || null;

  const rows: Array<{ itemId:string; name:string; qty:number; value:number }> = [];
  for (const it of items) {
    if (filterDep && s(it.departmentId||'') !== s(filterDep)) continue;
    const id = it.id;
    const name = it.name || id;
    const unitCost = n(it.unitCost, 0);
    const par = n(it.par, 0);

    const endQty = n(last[id], 0) + n(rec[id], 0) - n(sold[id], 0);
    const varianceQty = endQty - par; // positive = excess, negative = shortage
    const varianceValue = unitCost * Math.abs(varianceQty);

    if (varianceQty === 0) continue;

    rows.push({ itemId: id, name, qty: varianceQty, value: varianceValue });
  }

  const shortages = rows.filter(r => r.qty < 0).map(r => ({ ...r, qty: Math.abs(r.qty) }));
  const excesses  = rows.filter(r => r.qty > 0);
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

/** default export with all fns (tests use `variance.computeVarianceFromData`) */
const _default = {
  buildVariance,
  computeVariance,
  computeVarianceForDepartment,
  computeVarianceFromData,
};
export default _default;
