import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { calculateVelocity } from '../reports/velocityService';

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
  reason?: string | null;       // 'velocity-driven' | 'par-based' | 'insufficient-data'
  deptId?: string | null;
  deptName?: string | null;
  qtyDept?: number | null;
  // Velocity enrichment
  velocityPerWeek?: number | null;
  velocityTrend?: string | null;
  trendNote?: string | null;
  confidence?: string | null;
  currentStock?: number;
  estimatedCost?: number | null;
  flag?: string | null;          // 'possible-unrecorded-delivery' | 'po-shortfall'
  flagMessage?: string | null;
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
    expiryRisk?: boolean;
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
      expiryRisk: !!v?.expiryRisk,
    };
  });

  // Per-dept on-hand ONLY from items that exist in that department
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
        const qty = n(v?.lastCount, 0) + n(v?.incomingQty, 0) - n(v?.soldQty, 0);
        onHand[depId][pid] = (onHand[depId][pid] || 0) + qty;
      });
    }
  }

  // Load department snapshots for velocity data
  dlog('reading department snapshots for velocity');
  const allSnapshots: any[] = [];
  const missingInvoiceProductIds = new Set<string>();
  const poDiscrepancyProductIds = new Set<string>();

  for (const dep of depsSnap.docs) {
    try {
      const snapsQ = query(
        collection(db, 'venues', venueId, 'departments', dep.id, 'snapshots'),
        orderBy('completedAt', 'desc'),
        limit(6),
      );
      const snapsSnap = await getDocs(snapsQ);
      const depSnaps: any[] = snapsSnap.docs.map(d => d.data());
      allSnapshots.push(...depSnaps);

      // Findings from latest snapshot only (for flags)
      if (!snapsSnap.empty) {
        const latest = snapsSnap.docs[0].data() as any;
        const findings = latest.findings || {};
        for (const mi of (findings.likelyMissingInvoices || [])) {
          if (mi.productId) missingInvoiceProductIds.add(mi.productId);
        }
        for (const pd of (findings.poDiscrepancies || [])) {
          if (pd.productId) poDiscrepancyProductIds.add(pd.productId);
        }
      }
    } catch { /* no snapshots yet for this dept — skip */ }
  }

  // Build velocity map from all collected snapshots
  const velocityMap = allSnapshots.length > 0 ? calculateVelocity(allSnapshots) : new Map();
  dlog('velocity map built', velocityMap.size, 'products, snapshots:', allSnapshots.length);

  const buckets: Record<string,{ supplierName?:string; lines: SuggestedLine[] }> = {};
  const unassigned: { lines: SuggestedLine[] } = { lines: [] };

  for (const dep of departments) {
    const depId = dep.id;
    const onHandDept = onHand[depId] || {};
    const productIds = Object.keys(onHandDept);

    for (const pid of productIds) {
      const meta = prodMeta[pid] || {};
      const name = s(meta.name, pid);
      const onHandQty = n(onHandDept[pid], 0);

      // Dept PAR precedence: deptPar[depId] -> par -> default
      const parDeptRaw =
        (meta.deptPar && Number.isFinite(meta.deptPar[depId])) ? Number(meta.deptPar[depId]) :
        (Number.isFinite(meta.par) ? Number(meta.par) : undefined);
      const usedPar = Number.isFinite(parDeptRaw) ? Number(parDeptRaw) : defaultPar;

      // Velocity lookup (by product name, lowercased)
      const velData = velocityMap.get(name.toLowerCase().trim());
      const velocityPerWeek = velData?.emaVelocityPerWeek ?? velData?.unitsPerWeek ?? null;
      const velocityTrend = velData?.trend ?? null;
      const trendPercent = velData?.trendPercent ?? 0;
      const confidence = velData?.confidence ?? null;
      const isUsableVelocity = velocityPerWeek != null &&
        (confidence === 'high' || confidence === 'medium') &&
        velocityPerWeek > 0;

      // STEP 3 — Calculate demand-driven order qty
      let suggestedQty: number;
      let reason: string;

      if (isUsableVelocity) {
        // Velocity-driven: cover lead time + buffer, never below PAR
        const leadTimeDays = 7;
        const bufferDays = 3;
        const coverageNeeded = velocityPerWeek! * ((leadTimeDays + bufferDays) / 7);
        const velocityBased = Math.max(0, Math.ceil(coverageNeeded - onHandQty));
        const parMinimum = Number.isFinite(parDeptRaw) ? Math.max(0, usedPar - onHandQty) : 0;
        suggestedQty = Math.max(velocityBased, parMinimum);
        reason = 'velocity-driven';
      } else if (Number.isFinite(parDeptRaw)) {
        suggestedQty = Math.max(0, usedPar - onHandQty);
        reason = 'par-based';
      } else {
        suggestedQty = 0;
        reason = 'insufficient-data';
      }

      // STEP 4 — Intelligence filters
      let flag: string | null = null;
      let flagMessage: string | null = null;
      let trendNote: string | null = null;

      // Skip stagnant products that have stock
      if (velocityPerWeek != null && velocityPerWeek < 0.1 && onHandQty > 0) {
        suggestedQty = 0;
      }
      // Skip expiry risk products
      if (meta.expiryRisk === true || velData?.expiryRisk === true) {
        suggestedQty = 0;
      }

      // Flag missing invoice
      if (missingInvoiceProductIds.has(pid)) {
        flag = 'possible-unrecorded-delivery';
        flagMessage = 'Stock increased without invoice — verify receipt before ordering';
      }
      // Flag PO discrepancy
      if (poDiscrepancyProductIds.has(pid)) {
        flag = flag || 'po-shortfall';
        flagMessage = flagMessage || 'Previous order shortfall detected — chase supplier before reordering';
      }

      // Trend adjustment (velocity-driven items only, not skipped)
      if (suggestedQty > 0 && reason === 'velocity-driven') {
        if (velocityTrend === 'rising' && trendPercent > 15) {
          suggestedQty = Math.ceil(suggestedQty * 1.2);
          trendNote = 'Increased 20% for rising trend';
        } else if (velocityTrend === 'falling' && (trendPercent as number) < -15) {
          suggestedQty = Math.ceil(suggestedQty * 0.8);
          trendNote = 'Reduced 20% for falling trend';
        }
      }

      // STEP 5 — Pack size rounding
      const sid = s(meta.supplierId || '');
      const sname = s(meta.supplierName || (sid ? supplierNameById[sid] : ''), 'Supplier');
      const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
      const cost = n(meta.cost, 0);
      const qtyDept = pack && pack > 0 && roundToPack
        ? Math.ceil(suggestedQty / pack) * pack
        : Math.round(suggestedQty);

      if (qtyDept <= 0) continue;

      // STEP 6 — Build suggestion with reasoning
      const line: SuggestedLine = {
        productId: pid,
        productName: name,
        qty: qtyDept,
        unitCost: cost > 0 ? cost : null,
        packSize: pack,
        cost: cost > 0 ? cost : null,
        needsPar: !Number.isFinite(parDeptRaw),
        needsSupplier: !sid,
        reason: reason === 'velocity-driven' ? `velocity-driven` : (!sid ? 'No preferred supplier set' : reason),
        deptId: depId,
        deptName: dep.name,
        qtyDept,
        // Velocity enrichment
        velocityPerWeek: velocityPerWeek != null ? Math.round(velocityPerWeek * 100) / 100 : null,
        velocityTrend: velocityTrend ?? null,
        trendNote,
        confidence,
        currentStock: onHandQty,
        estimatedCost: cost > 0 ? Math.round(qtyDept * cost * 100) / 100 : null,
        flag,
        flagMessage,
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
  const velocityDriven = Object.values(buckets).reduce((a,b)=>a+(b.lines||[]).filter(l=>l.reason==='velocity-driven').length,0)
    + unassigned.lines.filter(l=>l.reason==='velocity-driven').length;
  dlog('summary', { suppliersWithLines, totalLines, velocityDriven, snapshotsUsed: allSnapshots.length });

  return { buckets, unassigned, _meta: { departments, velocityDriven, totalLines, snapshotsUsed: allSnapshots.length } };
}

/** Legacy shape kept for compatibility with createFromSuggestions/drafts/fromSuggestions.
 *  Keys are supplierId (or 'unassigned'); value carries a label + lines.
 */
export type SuggestedLegacyMap = Record<string, {
  supplierName?: string | null;
  lines: SuggestedLine[];
}>;
