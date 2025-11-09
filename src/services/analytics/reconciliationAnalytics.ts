// @ts-nocheck
/**
 * Pure client-side analytics over venue-level reconciliation docs.
 * Input shape is whatever ReconciliationsPanel loads from:
 *   venues/{venueId}/reconciliations/{id}
 */
export type Recon = {
  id: string;
  orderId: string;
  supplierName?: string | null;
  createdAt?: any; // Firestore TS or ISO
  totals?: { invoiceTotal?: number | null; orderTotal?: number | null; delta?: number | null };
  counts?: { matched?: number; unknown?: number; priceChanges?: number; qtyDiffs?: number; missingOnInvoice?: number };
  anomalies?: Array<any> | null;
  poMatch?: boolean;
};

function toDate(d: any): Date {
  if (!d) return new Date(NaN);
  if (typeof d?.toDate === 'function') return d.toDate();
  if (typeof d === 'number') return new Date(d);
  const t = new Date(d);
  return isNaN(+t) ? new Date(NaN) : t;
}

export function summarize(recs: Recon[]) {
  const n = recs.length;
  if (!n) {
    return {
      count: 0,
      poMatchPct: 0,
      totalDelta: 0,
      avgDelta: 0,
      matchedPct: 0,
      last14: [] as Array<{day: string; delta: number}>,
    };
  }

  let poMatchYes = 0;
  let totalDelta = 0;
  let matchedLines = 0;
  let totalLines = 0;

  const byDay: Record<string, number> = {};

  for (const r of recs) {
    const po = !!r?.poMatch;
    if (po) poMatchYes++;

    const inv = Number(r?.totals?.invoiceTotal ?? NaN);
    const ord = Number(r?.totals?.orderTotal ?? NaN);
    const delta = Number.isFinite(inv) && Number.isFinite(ord) ? inv - ord : Number(r?.totals?.delta ?? 0);
    totalDelta += Number.isFinite(delta) ? delta : 0;

    const ct = r?.counts || {};
    const lines = Number(ct?.matched ?? 0) + Number(ct?.unknown ?? 0) + Number(ct?.priceChanges ?? 0) + Number(ct?.qtyDiffs ?? 0) + Number(ct?.missingOnInvoice ?? 0);
    totalLines += lines;
    matchedLines += Number(ct?.matched ?? 0);

    const day = toDate(r?.createdAt);
    if (!isNaN(+day)) {
      const key = day.toISOString().slice(0,10);
      byDay[key] = (byDay[key] ?? 0) + (Number.isFinite(delta) ? delta : 0);
    }
  }

  // Last 14 days trend
  const today = new Date();
  const last14: Array<{day: string; delta: number}> = [];
  for (let i=13;i>=0;i--){
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0,10);
    last14.push({ day: key, delta: Number(byDay[key] ?? 0) });
  }

  return {
    count: n,
    poMatchPct: Math.round((poMatchYes / n) * 100),
    totalDelta: totalDelta,
    avgDelta: n ? (totalDelta / n) : 0,
    matchedPct: totalLines ? Math.round((matchedLines / totalLines) * 100) : 0,
    last14,
  };
}
