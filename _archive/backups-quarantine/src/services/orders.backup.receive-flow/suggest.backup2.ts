// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const dlog = (...a:any[]) => console.log('[SuggestedOrders]', ...a);

function n(v:any,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v:any,d=''){ return (typeof v==='string' && v.trim().length)?v.trim():d; }
function uniq<T>(arr:T[]){ return Array.from(new Set(arr)); }

export type DeptSnap = { id:string; name:string };

export type SuggestedLine = {
  productId: string;
  productName: string;
  qty: number;                 // For legacy (venue/global or merged)
  unitCost: number | null;
  packSize: number | null;
  // Flags expected by downstream code
  cost?: number | null;        // alias for unitCost (kept for callers)
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
  // NEW: department-aware
  deptId?: string | null;
  deptName?: string | null;
  qtyDept?: number | null;     // per-dept qty
};

export type SuggestedLegacyMap = {
  buckets: Record<string, { supplierName?: string; lines: SuggestedLine[] }>;
  unassigned: { lines: SuggestedLine[] };
  _meta?: {
    baselineCompletedAt?: number|null;
    reason?: string|null;
    departments?: DeptSnap[];
  } | {};
};

/**
 * Build department-aware Suggested Orders.
 * - Reads products once (global metadata: supplierId/name, global packSize, cost).
 * - Reads departments -> areas -> items to aggregate *per-dept* on-hand by product.
 * - PER-DEPT PAR: if product.deptPar is present and contains deptId, use that; else fall back to product.par / parLevel; else defaultPar.
 * - For each dept, computes neededDept = max(0, parDept - onHandDept).
 * - Emits per-dept lines (qtyDept) and also provides legacy qty on merged builds (caller-side).
 */
export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = { roundToPack: true, defaultParIfMissing: 6 }
): Promise<SuggestedLegacyMap> {
  dlog('ENTER buildSuggestedOrdersInMemory', { venueId, opts });
  const db = getFirestore(getApp());
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // 0) departments (for labels + iteration)
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const departments: DeptSnap[] = depsSnap.docs.map(d => ({ id: d.id, name: s((d.data() as any)?.name, 'Department') }));

  // 1) supplier names
  dlog('reading suppliers');
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string,string> = {};
  suppliersSnap.forEach(d => { supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier'); });

  // 2) products (metadata; allow dept-specific PAR via product.deptPar[deptId])
  dlog('reading products');
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  type ProdMeta = {
    name?: string;
    par?: number|undefined;
    deptPar?: Record<string, number>|undefined;
    supplierId?: string|undefined;
    supplierName?: string|undefined;
    packSize?: number|null;
    cost?: number;
  };
  const prodMeta: Record<string,ProdMeta> = {};
  productsSnap.forEach(d => {
    const v:any = d.data() || {};
    const sid = v?.supplierId || v?.supplier?.id || undefined;
    const sname = v?.supplierName || v?.supplier?.name || (sid ? supplierNameById[sid] : undefined);
    const deptPar = (v?.deptPar && typeof v.deptPar === 'object') ? v.deptPar : undefined;
    prodMeta[d.id] = {
      name: s(v?.name, String(d.id)),
      par: Number.isFinite(v?.par) ? Number(v.par) : (Number.isFinite(v?.parLevel) ? Number(v.parLevel) : undefined),
      deptPar,
      supplierId: sid,
      supplierName: sname,
      packSize: Number.isFinite(v?.packSize) ? Number(v.packSize) : null,
      cost: Number(v?.costPrice ?? v?.price ?? v?.unitCost ?? 0) || 0,
    };
  });

  // 3) per-DEPT on-hand by product
  dlog('reading departments/areas/items');
  // onHand[deptId][productId] = qty
  const onHand: Record<string, Record<string, number>> = {};
  for (const dep of depsSnap.docs) {
    const depId = dep.id;
    onHand[depId] = onHand[depId] || {};
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas', area.id, 'items'));
      itemsSnap.forEach(it => {
        const v:any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        if (!pid) return;
        const qty = n(v?.lastCount, 0);
        onHand[depId][pid] = (onHand[depId][pid] || 0) + qty;
      });
    }
  }

  // 4) build per-dept suggestions
  const buckets: Record<string,{ supplierName?:string; lines: SuggestedLine[] }> = {};
  const unassigned: { lines: SuggestedLine[] } = { lines: [] };

  for (const dep of departments) {
    const depId = dep.id;
    const onHandDept = onHand[depId] || {};
    const productIds = Object.keys(onHandDept);
    // Include products even if onHandDept has 0 lines? We keep it data-driven: only products with a count in this dept.
    // If we want "0-known" to surface, we’d require mapping dept → products list; out of scope for now.

    // We also want to include products that exist in catalog but had 0 counts in this dept.
    // That requires a pass over productsSnap; do it here:
    const unionPids = uniq([...productIds, ...Object.keys(prodMeta)]);

    for (const pid of unionPids) {
      const meta = prodMeta[pid] || {};
      const name = s(meta.name, pid);
      // DEPT PAR precedence: deptPar[depId] -> par -> default
      const parDeptRaw =
        (meta.deptPar && Number.isFinite(meta.deptPar[depId])) ? Number(meta.deptPar[depId]) :
        (Number.isFinite(meta.par) ? Number(meta.par) : undefined);
      const usedPar = Number.isFinite(parDeptRaw) ? Number(parDeptRaw) : defaultPar;

      const onHandQty = n(onHandDept[pid], 0);
      const needed = Math.max(0, usedPar - onHandQty);
      if (needed <= 0) continue;

      const sid = s(meta.supplierId || '');
      const sname = s(meta.supplierName || (sid ? supplierNameById[sid] : ''), 'Supplier');
      const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
      const cost = n(meta.cost, 0);

      const qtyDept = roundToPack && pack && pack>0 ? Math.ceil(needed / pack) * pack : Math.round(needed);

      const baseLine: SuggestedLine = {
        productId: pid,
        productName: name,
        // Legacy qty left as qtyDept for dept views; the "All" view will sum per product across depts in the UI layer.
        qty: qtyDept,
        unitCost: cost > 0 ? cost : null,
        packSize: pack,
        cost: cost > 0 ? cost : null,
        needsPar: !Number.isFinite(parDeptRaw),
        needsSupplier: !sid,
        reason: !sid ? 'No preferred supplier set'
              : (!Number.isFinite(parDeptRaw) ? `Dept PAR missing; used default ${usedPar}` : null),
        deptId: depId,
        deptName: dep.name,
        qtyDept,
      };

      if (!sid) {
        unassigned.lines.push(baseLine);
      } else {
        if (!buckets[sid]) buckets[sid] = { supplierName: sname, lines: [] };
        buckets[sid].lines.push(baseLine);
      }
    }
  }

  // Deduplicate (same product may appear more than once within same dept due to earlier guards; keep first per product+dept)
  Object.keys(buckets).forEach(sid => {
    const seen = new Set<string>();
    const clean: SuggestedLine[] = [];
    for (const l of (buckets[sid].lines || [])) {
      const k = `${l.productId}|${l.deptId || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if ((l.qtyDept ?? l.qty ?? 0) > 0) clean.push(l);
    }
    buckets[sid].lines = clean;
  });
  unassigned.lines = (unassigned.lines || []).filter((l:any)=> (l.qtyDept ?? l.qty ?? 0) > 0);

  const suppliersWithLines = Object.values(buckets).filter(b=> (b.lines||[]).length>0).length + (unassigned.lines.length>0?1:0);
  const totalLines = Object.values(buckets).reduce((a,b)=>a+(b.lines?.length||0),0) + unassigned.lines.length;

  dlog('summary', { suppliersWithLines, totalLines });

  return {
    buckets,
    unassigned,
    _meta: { departments },
  };
}
