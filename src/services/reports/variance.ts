/**
 * Variance + shrinkage reports.
 *
 * computeVarianceSnapshot reads precomputed snapshot docs written by
 * snapshotWriter.ts (departments/{deptId}/snapshots/cycle-{N}), not live
 * item docs — live docs have confirmedCount stamped to lastCount after cycle
 * completion, so reading them directly always yields zero variance.
 *
 * Screens use:
 *  - computeVarianceSnapshot(venueId, opts?) -> shortages/excesses totals
 *  - buildVariance / computeVariance(...)    -> UIResult with summary band
 */

import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

// ---------- helpers ----------
const n = (v: any, d = 0) => Number.isFinite(+v) ? +v : d;
const s = (v: any, d = '') => typeof v === 'string' && v.trim() ? v.trim() : d;

// ---------- legacy types (sync path, used by tests / older callers) ----------
type LegacyItem = { id: string; name: string; departmentId?: string | null; unitCost?: number | null; par?: number | null };
type LegacyInput = {
  items: LegacyItem[];
  lastCountsByItemId: Record<string, number>;
  receivedByItemId?: Record<string, number>;
  soldByItemId?: Record<string, number>;
  filterDepartmentId?: string | null;
};
type LegacyRow = {
  itemId: string;
  name: string;
  qty: number;
  value: number;
  theoreticalOnHand: number;
  deltaVsPar: number;
  valueImpact: number;
};
type LegacyResult = {
  scope: { venueId: string };
  shortages: LegacyRow[];
  excesses: LegacyRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};

// ---------- variance row + snapshot types (async path, used by screens) ----------
export type VarianceRow = {
  id: string;
  productId: string;
  name: string;
  unit?: string | null;
  supplierName?: string | null;

  // Expected vs actual
  par: number;       // expected stock
  onHand: number;    // counted stock
  variance: number;  // unexplained variance (invoice-/sales-aware); falls back to total movement
  value: number;     // |variance| * unitCost if available

  // total movement (closing − opening); differs from variance when snapshot has invoice/sales enrichment
  totalVarianceQty?: number | null;
  totalVarianceDollars?: number | null;

  // NEW: cost tiers + shrinkage metrics + flow context
  listCost?: number | null;
  landedCost?: number | null;
  realCostPerUnit?: number | null;
  shrinkUnits?: number | null;
  shrinkValue?: number | null;
  salesQty?: number | null;
  invoiceQty?: number | null;

  lastDeliveryAt?: any;
  auditTrail?: any[];
};

export type VarianceSnapshotResult = {
  shortages: VarianceRow[];
  excesses: VarianceRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};

// ---------- async snapshot: main entry for VarianceSnapshotScreen ----------
// Reads from departments/{deptId}/snapshots/cycle-{N} (written by snapshotWriter.ts),
// NOT live item docs. Live docs have confirmedCount stamped to lastCount's value right
// after a cycle completes, so onHand - expected is always 0 there. The snapshot's
// openingCount/actualClosing/totalVarianceQty/totalVarianceDollars are the correct,
// already-computed baseline-vs-closing comparison for that cycle.
export async function computeVarianceSnapshot(
  venueId: string,
  opts: { departmentId?: string | null; windowDays?: number } = {}
): Promise<VarianceSnapshotResult> {
  if (!venueId) throw new Error('venueId is required');

  const shortages: VarianceRow[] = [];
  const excesses: VarianceRow[] = [];
  let totalShortageValue = 0;
  let totalExcessValue = 0;

  const deptId = opts.departmentId ?? undefined;

  let deptIds: string[] = [];
  if (deptId) {
    deptIds = [deptId];
  } else {
    const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
    deptIds = deptsSnap.docs.map(d => d.id);
  }

  for (const dId of deptIds) {
    // Get the latest snapshot for this department
    const snapshotsSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'departments', dId, 'snapshots'),
        orderBy('cycleNumber', 'desc'),
        limit(1)
      )
    );
    if (snapshotsSnap.empty) continue;

    const snapshot = snapshotsSnap.docs[0].data() as any;

    // Skip snapshots with no baseline — cycle-0 always, legacy first cycles, and any with missing prev snapshot
    if (!snapshot.dataCompleteness?.hasBaseline) continue;

    for (const item of (snapshot.items || [])) {
      // Only items with a baseline (openingCount known from previous cycle)
      if (item.openingCount == null) continue;

      // Prefer the invoice-/sales-aware unexplained figure; fall back to total movement.
      // When unexplained = 0 (movement fully accounted for), the item is not actionable
      // and is intentionally dropped — this is a visible behaviour change from total-only.
      const variance = item.unexplainedVarianceQty ?? item.totalVarianceQty ?? (item.actualClosing - item.openingCount);
      if (variance === 0) continue;

      const value = item.unexplainedVarianceDollars ?? item.totalVarianceDollars ?? (item.costPrice != null ? variance * item.costPrice : 0);

      const row: VarianceRow = {
        id: item.productId || item.name,
        productId: item.productId || item.name,
        name: item.name,
        unit: null,
        supplierName: null,
        par: item.parLevel ?? 0,
        onHand: item.actualClosing,
        variance,
        value: Math.abs(value),
        totalVarianceQty: item.totalVarianceQty ?? null,
        totalVarianceDollars: item.totalVarianceDollars ?? null,
        listCost: item.costPrice ?? null,
        landedCost: item.costPrice ?? null,
        realCostPerUnit: item.costPrice ?? null,
        shrinkUnits: variance < 0 ? Math.abs(variance) : 0,
        shrinkValue: variance < 0 && item.costPrice ? Math.abs(variance) * item.costPrice : 0,
        salesQty: item.soldQty ?? 0,
        invoiceQty: item.receivedQty ?? 0,
        lastDeliveryAt: null,
        auditTrail: [],
      };

      if (variance < 0) {
        shortages.push(row);
        totalShortageValue += Math.abs(value);
      } else {
        excesses.push(row);
        totalExcessValue += Math.abs(value);
      }
    }
  }

  // Sort by absolute value descending — biggest variances first
  shortages.sort((a, b) => b.value - a.value);
  excesses.sort((a, b) => b.value - a.value);

  return { shortages, excesses, totalShortageValue, totalExcessValue };
}

// ---------- async UI path (banded summary) ----------
type UIResult = {
  summary: { message: string; withinBand: boolean; bandPct: number };
  rowsMaterial: VarianceRow[];
  rowsMinor: VarianceRow[];
};

export async function buildVariance(venueId: string, opts: any = {}): Promise<UIResult> {
  const bandPct = n(opts.bandPct, 1.5);

  const snapshot = await computeVarianceSnapshot(venueId, {
    departmentId: opts.departmentId ?? null,
    windowDays: opts.windowDays,
  });

  const totalShort = n(snapshot.totalShortageValue, 0);
  const totalExcess = n(snapshot.totalExcessValue, 0);
  const totalAtRisk = totalShort + totalExcess;

  let message = 'No variance detected in this window';
  if (totalAtRisk > 0) {
    message = `Shortages $${totalShort.toFixed(2)}, excess $${totalExcess.toFixed(2)}`;
  }

  const withinBand = true;
  const rowsMaterial = [...snapshot.shortages, ...snapshot.excesses];
  const rowsMinor: VarianceRow[] = [];

  return {
    summary: { message, withinBand, bandPct },
    rowsMaterial,
    rowsMinor,
  };
}

// ---------- sync path for tests (unchanged legacy math) ----------
export function computeVarianceFromData(data: LegacyInput): LegacyResult {
  const items = data.items || [];
  const last = data.lastCountsByItemId || {};
  const rec = data.receivedByItemId || {};
  const sold = data.soldByItemId || {};
  const dept = data.filterDepartmentId || null;

  const shortages: LegacyRow[] = [];
  const excesses: LegacyRow[] = [];
  for (const it of items) {
    if (dept && s(it.departmentId || '') !== dept) continue;
    const par = n(it.par, 0);
    const cost = n(it.unitCost, 0);
    const theoretical = n(last[it.id], 0) + n(rec[it.id], 0) - n(sold[it.id], 0);
    const delta = theoretical - par;
    const valueImpact = Math.abs(delta) * cost;

    const row: LegacyRow = {
      itemId: it.id,
      name: it.name,
      qty: Math.abs(delta),
      value: cost * Math.abs(delta),
      theoreticalOnHand: theoretical,
      deltaVsPar: delta,
      valueImpact,
    };
    if (delta < 0) shortages.push(row);
    else if (delta > 0) excesses.push(row);
  }

  const totalShortageValue = shortages.reduce((a, r) => a + r.value, 0);
  const totalExcessValue = excesses.reduce((a, r) => a + r.value, 0);
  return { scope: { venueId: 'unknown' }, shortages, excesses, totalShortageValue, totalExcessValue };
}

// ---------- unified overload ----------
export function computeVariance(data: LegacyInput): LegacyResult;
export function computeVariance(venueId: string, opts?: any): Promise<UIResult>;
export function computeVariance(arg1: any, arg2?: any): any {
  return (typeof arg1 === 'object' && !Array.isArray(arg1))
    ? computeVarianceFromData(arg1)
    : buildVariance(String(arg1), arg2 || {});
}

export async function computeVarianceForDepartment(
  venueId: string,
  departmentId: string,
  opts: any = {}
): Promise<UIResult> {
  return buildVariance(venueId, { ...(opts || {}), departmentId });
}

export default {
  buildVariance,
  computeVariance,
  computeVarianceForDepartment,
  computeVarianceFromData,
  computeVarianceSnapshot,
};
