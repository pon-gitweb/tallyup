// @ts-nocheck
/**
 * AI Suggested Orders — client-fed aggregates + minimal filtering.
 * Keep payload tiny, deterministic, and Expo-safe.
 */

export type SupplierHint = { id: string; name: string };

export type AggregateSignals = {
  id: string;
  name: string;
  supplierId?: string | null;
  supplierName?: string | null;
  par?: number | null;
  unitCost?: number | null;
  packSize?: number | null;

  // Optional lightweight usage signals (store on product docs if you have them)
  avgDailyUsage_30?: number | null;
  avgDailyUsage_90?: number | null;
  avgDailyUsage_180?: number | null;
  avgDailyUsage_270?: number | null;

  // Optional stock snapshot signals (if you keep them)
  onHand?: number | null;
  daysSinceLastCount?: number | null;
};

const n = (v: any, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const s = (v: any, d = '') => (typeof v === 'string' ? v : d);

/**
 * Minimal candidate filter for AI-worthiness
 * - include if missing supplier
 * - include if onHand < par (when both exist)
 * - include if onHand < k * avgDailyUsage_30 (when available)
 * - otherwise exclude to keep token count small
 */
export function filterAICandidates(
  products: AggregateSignals[],
  opts?: { k?: number; max?: number }
): AggregateSignals[] {
  const k = n(opts?.k, 3);       // “days of cover” factor
  const max = Math.max(50, n(opts?.max, 400));

  const keep: AggregateSignals[] = [];
  for (const p of products) {
    const hasSupplier = !!s(p?.supplierId, '');
    const par = n(p?.par, 0);
    const onHand = n(p?.onHand, NaN);
    const usage = n(p?.avgDailyUsage_30, NaN);

    const missingSupplier = !hasSupplier;
    const lowVsPar = Number.isFinite(onHand) && par > 0 && onHand < par;
    const lowVsUsage = Number.isFinite(onHand) && Number.isFinite(usage) && onHand < k * usage;

    if (missingSupplier || lowVsPar || lowVsUsage) {
      keep.push(p);
      if (keep.length >= max) break;
    }
  }
  return keep;
}

/**
 * Build the request body for /api/suggest-ai (variance-style).
 * Pass only the pared-down supplier hints and filtered product aggregates.
 */
export function buildAISuggestRequestBody(args: {
  venueId: string;
  suppliers: SupplierHint[];
  products: AggregateSignals[];
  historyDays?: number; // optional hint for the server prompt
}) {
  const venueId = s(args?.venueId, '');
  const historyDays = Math.max(7, Number.isFinite(args?.historyDays) ? Number(args.historyDays) : 28);
  const suppliers = Array.isArray(args?.suppliers) ? args.suppliers.map((x) => ({ id: s(x.id, ''), name: s(x.name, 'Supplier') })) : [];

  const products = (Array.isArray(args?.products) ? args.products : []).map((p) => ({
    id: s(p.id, ''),
    name: s(p.name, p.id || 'Item'),
    supplierId: s(p?.supplierId, '') || null,
    supplierName: s(p?.supplierName, '') || null,
    par: Number.isFinite(p?.par) ? Number(p.par) : 0,
    unitCost: Number.isFinite(p?.unitCost) ? Number(p.unitCost) : 0,
    packSize: Number.isFinite(p?.packSize) ? Number(p.packSize) : null,

    avgDailyUsage_30: Number.isFinite(p?.avgDailyUsage_30) ? Number(p.avgDailyUsage_30) : 0,
    avgDailyUsage_90: Number.isFinite(p?.avgDailyUsage_90) ? Number(p.avgDailyUsage_90) : 0,
    avgDailyUsage_180: Number.isFinite(p?.avgDailyUsage_180) ? Number(p.avgDailyUsage_180) : 0,
    avgDailyUsage_270: Number.isFinite(p?.avgDailyUsage_270) ? Number(p.avgDailyUsage_270) : 0,

    onHand: Number.isFinite(p?.onHand) ? Number(p.onHand) : null,
    daysSinceLastCount: Number.isFinite(p?.daysSinceLastCount) ? Number(p.daysSinceLastCount) : null,
  })).filter((p) => p.id);

  return { venueId, historyDays, suppliers, products };
}
