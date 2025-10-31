// @ts-nocheck
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const dlog = (...a:any[]) => console.log('[SuggestedOrders]', ...a);

function n(v:any,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v:any,d=''){ return (typeof v==='string' && v.trim().length)?v.trim():d; }

export type DeptSnap = { id:string; name:string };
export type SuggestedLine = {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number | null;
  packSize: number | null;
  cost?: number | null;
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
  deptId?: string | null;
  deptName?: string | null;
  qtyDept?: number | null;
};

export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = { roundToPack: true, defaultParIfMissing: 6 }
){
  dlog('ENTER buildSuggestedOrdersInMemory', { opts, venueId });
  const db = getFirestore(getApp());
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // Departments
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const departments: DeptSnap[] = depsSnap.docs.map(d => ({ id: d.id, name: s((d.data() as any)?.name, 'Department') }));

  // Suppliers
  dlog('reading suppliers');
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string,string> = {};
  suppliersSnap.forEach(d => { supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier'); });

  // Products
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

  // Per-dept on-hand ONLY from items that exist in that department (no global union)
  dlog('reading departments/areas/items');
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

  const buckets: Record<string,{ supplierName?:string; lines: SuggestedLine[] }> = {};
  const unassigned: { lines: SuggestedLine[] } = { lines: [] };

  for (const dep of departments) {
    const depId = dep.id;
    const onHandDept = onHand[depId] || {};
    const productIds = Object.keys(onHandDept); // <-- key change: only products seen in this dept

    // If a department has no items counted, it contributes no suggestions (good: Office stays empty).
    for (const pid of productIds) {
      const meta = prodMeta[pid] || {};
      const name = s(meta.name, pid);

      // Dept PAR precedence: deptPar[depId] -> par -> default
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
      const qtyDept = pack && pack>0 && opts.roundToPack ? Math.ceil(needed / pack) * pack : Math.round(needed);

      const line: SuggestedLine = {
        productId: pid,
        productName: name,
        qty: qtyDept, // dept view uses this; "All" sums later in UI
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
        unassigned.lines.push(line);
      } else {
        if (!buckets[sid]) buckets[sid] = { supplierName: sname, lines: [] };
        buckets[sid].lines.push(line);
      }
    }
  }

  // Clean up zeroes (defensive)
  Object.keys(buckets).forEach(sid => {
    buckets[sid].lines = (buckets[sid].lines || []).filter(l => (l.qtyDept ?? l.qty ?? 0) > 0);
  });
  unassigned.lines = (unassigned.lines || []).filter(l => (l.qtyDept ?? l.qty ?? 0) > 0);

  const suppliersWithLines = Object.values(buckets).filter(b=> (b.lines||[]).length>0).length + (unassigned.lines.length>0?1:0);
  const totalLines = Object.values(buckets).reduce((a,b)=>a+(b.lines?.length||0),0) + unassigned.lines.length;
  dlog('summary', { suppliersWithLines, totalLines });

  return { buckets, unassigned, _meta: { departments } };
}

/** Legacy shape kept for compatibility with createFromSuggestions/drafts/fromSuggestions.
 *  Keys are supplierId (or 'unassigned'); value carries a label + lines.
 */
export type SuggestedLegacyMap = Record<string, {
  supplierName?: string | null;
  lines: SuggestedLine[];
}>;
