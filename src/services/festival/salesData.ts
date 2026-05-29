// @ts-nocheck
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalesDataPoint {
  productId: string;
  productName: string;
  barId: string | null;
  barName: string | null;
  date: Date;
  unitsSold: number;
  revenue: number | null;
  source: 'pos-upload' | 'manual-entry' | 'session-count' | 'benchmark';
  confidence: 'high' | 'medium' | 'low';
  uploadId: string | null;
}

export interface SalesPeriodSummary {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  hasActualSales: boolean;
  salesSource: string;
  totalUnitsSold: number;
  totalRevenue: number | null;
  byProduct: Record<string, number>;
  byBar: Record<string, Record<string, number>>;
  confidence: 'high' | 'medium' | 'low';
}

export type FestivalCycleLength = 'daily' | 'weekly' | 'multi-day';

// ─── Period detection ─────────────────────────────────────────────────────────

export function detectSalesPeriod(
  dates: Date[],
  eventStartDate: Date,
  cycleLength: FestivalCycleLength,
): {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  periodType: 'day' | 'session' | 'week' | 'event';
} {
  if (dates.length === 0) {
    const now = new Date();
    return { periodStart: now, periodEnd: now, periodLabel: 'Unknown period', periodType: 'day' };
  }

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const periodStart = sorted[0];
  const periodEnd = sorted[sorted.length - 1];
  const dayMs = 24 * 60 * 60 * 1000;

  const startDay = Math.max(1, Math.floor((periodStart.getTime() - eventStartDate.getTime()) / dayMs) + 1);
  const endDay = Math.max(1, Math.floor((periodEnd.getTime() - eventStartDate.getTime()) / dayMs) + 1);

  if (startDay === endDay) {
    const label = periodStart.toLocaleDateString('en-NZ', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return { periodStart, periodEnd, periodLabel: `Day ${startDay} — ${label}`, periodType: 'day' };
  }

  const weekStart = Math.ceil(startDay / 7);
  const weekEnd = Math.ceil(endDay / 7);
  if (weekStart === weekEnd) {
    return {
      periodStart, periodEnd,
      periodLabel: `Week ${weekStart} (Day ${startDay}–${endDay})`,
      periodType: 'week',
    };
  }

  return {
    periodStart, periodEnd,
    periodLabel: `Days ${startDay}–${endDay}`,
    periodType: 'event',
  };
}

// ─── Format detection ─────────────────────────────────────────────────────────

export function detectPOSFormat(headers: string[]): 'square' | 'wavier' | 'generic' | 'unknown' {
  const n = headers.map(h => (h || '').toLowerCase().trim());

  const isSquare =
    n.some(h => h === 'location' || h.includes('location')) &&
    n.some(h => h === 'item' || h === 'item name' || h.includes('item')) &&
    (n.some(h => h.includes('net sales') || h.includes('gross sales') || h.includes('net amount')) ||
     n.some(h => h === 'qty' || h === 'quantity'));
  if (isSquare) return 'square';

  const isWavier =
    n.some(h => h === 'venue' || h.includes('venue')) &&
    n.some(h => h.includes('product') || h.includes('item name') || h.includes('item')) &&
    (n.some(h => h === 'sold' || h.includes('total sold') || h.includes('units sold')) ||
     n.some(h => h.includes('revenue') || h.includes('amount')));
  if (isWavier) return 'wavier';

  const isGeneric =
    n.some(h => h.includes('product') || h.includes('item') || h.includes('name') || h.includes('description')) &&
    n.some(h => h.includes('qty') || h.includes('quantity') || h.includes('sold') || h.includes('count') || h.includes('units'));
  if (isGeneric) return 'generic';

  return 'unknown';
}

// ─── Column detection per format ──────────────────────────────────────────────

export function detectColumns(headers: string[], format: 'square' | 'wavier' | 'generic' | 'unknown') {
  const n = headers.map(h => (h || '').toLowerCase().trim());

  function find(...candidates: string[]) {
    for (const c of candidates) {
      const idx = n.findIndex(h => h === c || h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  if (format === 'square') {
    return {
      product: find('item name', 'item', 'product', 'description'),
      qty: find('qty', 'quantity', 'count', 'units'),
      date: find('date', 'day', 'time'),
      location: find('location', 'bar', 'venue', 'site'),
      revenue: find('net sales', 'gross sales', 'net amount', 'total price', 'revenue', 'amount'),
    };
  }
  if (format === 'wavier') {
    return {
      product: find('item name', 'product name', 'product', 'item'),
      qty: find('total sold', 'sold', 'quantity', 'qty', 'count', 'units'),
      date: find('date', 'day', 'timestamp'),
      location: find('venue', 'location', 'bar', 'site'),
      revenue: find('revenue', 'total revenue', 'amount', 'sales'),
    };
  }
  // Generic or unknown
  return {
    product: find('product name', 'product', 'item name', 'item', 'name', 'description'),
    qty: find('quantity sold', 'qty sold', 'sold', 'quantity', 'qty', 'count', 'units'),
    date: find('date', 'day', 'timestamp', 'time'),
    location: find('location', 'bar', 'venue', 'station', 'pos', 'terminal'),
    revenue: find('revenue', 'total', 'amount', 'sales', 'gross', 'net'),
  };
}

// ─── Sales aggregation ────────────────────────────────────────────────────────

export async function getSalesSummary(
  venueId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<SalesPeriodSummary> {
  const empty: SalesPeriodSummary = {
    periodStart, periodEnd, periodLabel: '',
    hasActualSales: false, salesSource: 'none',
    totalUnitsSold: 0, totalRevenue: null,
    byProduct: {}, byBar: {}, confidence: 'low',
  };

  try {
    const uploadsSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'event', 'details', 'salesData'),
        where('periodStart', '>=', Timestamp.fromDate(periodStart)),
        where('periodEnd', '<=', Timestamp.fromDate(periodEnd)),
      )
    );
    if (uploadsSnap.empty) return empty;

    const byProduct: Record<string, number> = {};
    const byBar: Record<string, Record<string, number>> = {};
    let totalUnitsSold = 0;
    let totalRevenue: number | null = null;
    let salesSource = 'pos-upload';
    const periodLabel = (uploadsSnap.docs[0].data() as any).periodLabel || '';

    for (const uploadDoc of uploadsSnap.docs) {
      const data = uploadDoc.data() as any;
      if (data.source === 'manual-entry') salesSource = 'manual-entry';
      for (const line of (data.lineItems || [])) {
        const pid = line.productId;
        if (!pid) continue;
        const barId = line.barId || '_all';
        const units = line.unitsSold || 0;
        byProduct[pid] = (byProduct[pid] || 0) + units;
        if (!byBar[barId]) byBar[barId] = {};
        byBar[barId][pid] = (byBar[barId][pid] || 0) + units;
        totalUnitsSold += units;
        if (line.revenue != null) {
          if (totalRevenue === null) totalRevenue = 0;
          totalRevenue += line.revenue;
        }
      }
    }

    return {
      periodStart, periodEnd, periodLabel,
      hasActualSales: true,
      salesSource,
      totalUnitsSold, totalRevenue,
      byProduct, byBar,
      confidence: salesSource === 'pos-upload' ? 'high' : 'medium',
    };
  } catch {
    return empty;
  }
}

// ─── Velocity from sales ──────────────────────────────────────────────────────

export function calculateVelocityFromSales(
  sales: SalesDataPoint[],
  eventDurationHours: number,
): Record<string, number> {
  if (eventDurationHours <= 0 || sales.length === 0) return {};
  const byProduct: Record<string, number> = {};
  for (const s of sales) {
    byProduct[s.productId] = (byProduct[s.productId] || 0) + s.unitsSold;
  }
  const velocity: Record<string, number> = {};
  for (const [pid, total] of Object.entries(byProduct)) {
    velocity[pid] = total / eventDurationHours;
  }
  return velocity;
}
