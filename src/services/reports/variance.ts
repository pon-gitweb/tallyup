// @ts-nocheck
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { computeUnified, UnifiedOptions, UnifiedResult } from './varianceEngine';
import { fetchCounts, fetchInvoices, fetchSales } from './dataAdapters';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[variance]', ...a); };

export type VarianceRow = {
  id?: string;
  productId?: string;
  name?: string;
  sku?: string;
  unit?: string;
  supplierName?: string;
  par?: number;
  onHand?: number;
  variance?: number;
  value?: number;
  unitCost?: number;
};
export type VarianceDoc = {
  generatedAt?: any;
  shortages?: VarianceRow[];
  excesses?: VarianceRow[];
  totalShortageValue?: number;
  totalExcessValue?: number;
};

function candidateDocs(venueId: string, departmentId?: string) {
  const v = venueId, d = departmentId;
  const list = [
    `venues/${v}/reports/variance`,
    `venues/${v}/computed/variance`,
    `venues/${v}/analytics/variance`,
  ];
  if (d) {
    list.unshift(
      `venues/${v}/departments/${d}/reports/variance`,
      `venues/${v}/departments/${d}/computed/variance`,
    );
  }
  return list;
}
async function readDocIfExists(path: string) {
  try {
    const ref = doc(db, path);
    const snap = await getDoc(ref);
    if (snap.exists()) return { ok: true, data: snap.data(), path };
    return { ok: false, reason: 'not_found', path };
  } catch (e:any) {
    dlog('readCandidate error', path, e);
    return { ok: false, reason: e?.message || String(e), path };
  }
}
function coerceVariance(v: any): VarianceDoc {
  const shortages = Array.isArray(v?.shortages) ? v.shortages : [];
  const excesses  = Array.isArray(v?.excesses)  ? v.excesses  : [];
  const totalShortageValue = Number(v?.totalShortageValue || 0);
  const totalExcessValue   = Number(v?.totalExcessValue || 0);
  return { generatedAt: v?.generatedAt, shortages, excesses, totalShortageValue, totalExcessValue };
}

/** Legacy shape for existing screens */
export async function computeVarianceSnapshot(venueId: string): Promise<VarianceDoc> {
  const cands = candidateDocs(venueId);
  for (const p of cands) {
    const r = await readDocIfExists(p);
    if (r.ok) return coerceVariance(r.data);
  }
  // Fallback stub
  return {
    shortages: [
      { id:'s1', name:'Gin 1L', sku:'GIN-1L', variance:-2, value:-65, unitCost:32.5 },
      { id:'s2', name:'Lime Juice 1L', sku:'LJ-1L', variance:-6, value:-18, unitCost:3 },
    ],
    excesses: [{ id:'e1', name:'Tonic 200ml', sku:'TON-200', variance:12, value:15.6, unitCost:1.3 }],
    totalShortageValue: 83.0, totalExcessValue: 15.6
  };
}
export async function computeVarianceForDepartment(venueId: string, departmentId?: string): Promise<VarianceDoc> {
  const cands = candidateDocs(venueId, departmentId);
  for (const p of cands) {
    const r = await readDocIfExists(p);
    if (r.ok) return coerceVariance(r.data);
  }
  return computeVarianceSnapshot(venueId);
}

/** NEW unified API — combines counts + sales + invoices + expected/par. */
export async function computeVarianceUnified(
  venueId: string,
  departmentId: string | undefined,
  window: { from?: number; to?: number },
  options: UnifiedOptions = {}
): Promise<UnifiedResult> {
  // Fetch sources (schema-safe; empty arrays if blocked by rules)
  const [counts, sales, invoices] = await Promise.all([
    fetchCounts(venueId, window, departmentId),
    fetchSales(venueId, window, departmentId),
    fetchInvoices(venueId, window, departmentId),
  ]);
  return computeUnified(counts, sales, invoices, options);
}

export default {
  computeVarianceSnapshot,
  computeVarianceForDepartment,
  computeVarianceUnified,
};
