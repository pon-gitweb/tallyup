// @ts-nocheck
/**
 * Variance + shrinkage reports.
 *
 * This file has two paths:
 *  - Legacy sync math for tests (computeVarianceFromData)
 *  - Async path that uses data adapters + varianceEngine.computeUnified
 *
 * Screens use:
 *  - computeVarianceSnapshot(venueId, opts?) -> shortages/excesses totals
 *  - buildVariance / computeVariance(...)    -> UIResult with summary band
 */

import { fetchCounts, fetchSales, fetchInvoices } from './dataAdapters';
import { computeUnified } from './varianceEngine';

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
  variance: number;  // onHand - par
  value: number;     // |variance| * unitCost if available

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

// Map unified engine rows into the shape expected by VarianceSnapshotScreen.
function mapUnifiedToVarianceRow(r: any): VarianceRow {
  const expected = n(r?.expected, 0);
  const onHand = n(r?.onHand, 0);
  const variance = n(r?.variance, onHand - expected);

  const unitCost = Number.isFinite(r?.unitCost) ? Number(r.unitCost) : 0;

  const listCost = Number.isFinite(r?.listCostPerUnit)
    ? Number(r.listCostPerUnit)
    : (unitCost || null);

  const landedCost = Number.isFinite(r?.landedCostPerUnit)
    ? Number(r.landedCostPerUnit)
    : (listCost ?? null);

  const realCostPerUnit = Number.isFinite(r?.realCostPerUnit)
    ? Number(r.realCostPerUnit)
    : (landedCost ?? null);

  const shrinkUnits = Number.isFinite(r?.shrinkUnits)
    ? Number(r.shrinkUnits)
    : (r?.shrinkage < 0 ? Math.abs(Number(r.shrinkage)) : 0);

  const shrinkValue = Number.isFinite(r?.shrinkValue)
    ? Number(r.shrinkValue)
    : (shrinkUnits && unitCost ? shrinkUnits * unitCost : 0);

  const value = unitCost ? Math.abs(variance) * unitCost : 0;

  return {
    id: String(r?.sku || r?.productId || ''),
    productId: String(r?.sku || r?.productId || ''),
    name: s(r?.name, String(r?.sku || 'Item')),
    unit: null,
    supplierName: null,
    par: expected,
    onHand,
    variance,
    value,
    listCost,
    landedCost,
    realCostPerUnit,
    shrinkUnits,
    shrinkValue,
    salesQty: n(r?.salesQty, 0),
    invoiceQty: n(r?.invoiceQty, 0),
    lastDeliveryAt: null,
    auditTrail: [],
  };
}

// ---------- async snapshot: main entry for VarianceSnapshotScreen ----------
export async function computeVarianceSnapshot(
  venueId: string,
  opts: { departmentId?: string | null; windowDays?: number } = {}
): Promise<VarianceSnapshotResult> {
  if (!venueId) throw new Error('venueId is required');

  const window: { from?: number; to?: number } = {};
  const deptId = opts.departmentId ?? undefined;

  const counts = await fetchCounts(venueId, window, deptId);
  const sales = await fetchSales(venueId, window, deptId);
  const invoices = await fetchInvoices(venueId, window, deptId);

  const unified = computeUnified(counts, sales, invoices, {});

  const shortages = (unified.shortages || []).map(mapUnifiedToVarianceRow);
  const excesses = (unified.excesses || []).map(mapUnifiedToVarianceRow);

  return {
    shortages,
    excesses,
    totalShortageValue: n(unified?.totals?.shortageValue, 0),
    totalExcessValue: n(unified?.totals?.excessValue, 0),
  };
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
