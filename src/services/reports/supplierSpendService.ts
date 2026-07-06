// Pure math — reads invoices + snapshot velocity to produce supplier spend data.

import { db } from '../firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { calculateVelocity } from './velocityService';

export interface ProductBreakdownItem {
  productId: string;
  productName: string;
  unitsReceived: number;
  unitCost: number;
  totalCost: number;
  percentOfSpend: number;
  velocity: number | null;
  performanceStatus: string | null;
}

export interface SupplierSpendData {
  supplierId: string;
  supplierName: string;
  period: { start: Date; end: Date };
  totalSpend: number;
  invoiceCount: number;
  productCount: number;
  averageOrderValue: number;
  productBreakdown: ProductBreakdownItem[];
  hasSalesData: boolean;
  revenueFromProducts: number | null;
  grossMargin: number | null;
  marginPercent: number | null;
  budgetAmount: number | null;
  budgetVariance: number | null;
  budgetVariancePercent: number | null;
  overBudget: boolean;
  spendJustified: boolean | null;
  justificationReason: string;
  previousPeriodSpend: number | null;
  spendTrend: number | null;
  spendTrendPercent: number | null;
  fastMovers: number;
  slowMovers: number;
  stagnantProducts: number;
}

async function sumInvoiceLines(
  venueId: string,
  invoiceDocs: any[],
): Promise<Map<string, { productId: string; productName: string; unitsReceived: number; unitCost: number; totalCost: number }>> {
  const map = new Map<string, any>();
  for (const inv of invoiceDocs) {
    try {
      const linesSnap = await getDocs(
        collection(db, 'venues', venueId, 'invoices', inv.id, 'lines'),
      );
      linesSnap.forEach(lineDoc => {
        const line = lineDoc.data() as any;
        const pid = line.productId || lineDoc.id;
        const pname = (line.productName || line.name || 'Unknown').toLowerCase().trim();
        const qty = typeof line.qty === 'number' ? line.qty :
                    typeof line.quantity === 'number' ? line.quantity : 0;
        // FIX 4: accept all cost field variants across invoice write paths
        const unitCost =
          typeof line.unitCost === 'number' ? line.unitCost :
          typeof line.cost === 'number' ? line.cost :
          typeof line.unitPrice === 'number' ? line.unitPrice :
          typeof line.price === 'number' ? line.price : 0;
        const total = typeof line.lineTotal === 'number' ? line.lineTotal :
                      typeof line.total === 'number' ? line.total :
                      qty * unitCost;

        const existing = map.get(pname);
        if (existing) {
          existing.unitsReceived += qty;
          existing.totalCost += total;
        } else {
          map.set(pname, {
            productId: pid,
            productName: line.productName || line.name || 'Unknown',
            unitsReceived: qty,
            unitCost,
            totalCost: total,
          });
        }
      });
    } catch {}
  }
  return map;
}

export async function calculateSupplierSpend(
  venueId: string,
  supplierId: string,
  supplierName: string,
  periodStart: Date,
  periodEnd: Date,
  budgetAmount: number | null = null,
  snapshots: any[] = [],
): Promise<SupplierSpendData> {
  const startTs = Timestamp.fromDate(periodStart);
  const endTs = Timestamp.fromDate(periodEnd);

  // FIX 3: Read invoices using invoiceDateTimestamp first, then legacy 'date' field.
  // InvoiceScreen wrote 'invoiceDate' (string); upsertInvoiceFromOrder wrote 'date' (Timestamp).
  // Both now also write 'invoiceDateTimestamp' for forward compatibility.
  let invoiceDocs: any[] = [];
  try {
    const seen = new Set<string>();
    // Query invoiceDateTimestamp (new canonical field)
    try {
      const snap1 = await getDocs(query(
        collection(db, 'venues', venueId, 'invoices'),
        where('supplierId', '==', supplierId),
        where('invoiceDateTimestamp', '>=', startTs),
        where('invoiceDateTimestamp', '<=', endTs),
      ));
      for (const d of snap1.docs) { seen.add(d.id); invoiceDocs.push({ id: d.id, ...d.data() }); }
    } catch {}
    // Also query legacy 'date' field and merge
    try {
      const snap2 = await getDocs(query(
        collection(db, 'venues', venueId, 'invoices'),
        where('supplierId', '==', supplierId),
        where('date', '>=', startTs),
        where('date', '<=', endTs),
      ));
      for (const d of snap2.docs) {
        if (!seen.has(d.id)) { seen.add(d.id); invoiceDocs.push({ id: d.id, ...d.data() }); }
      }
    } catch {}
  } catch {}

  const productMap = await sumInvoiceLines(venueId, invoiceDocs);
  const totalSpend = Array.from(productMap.values()).reduce((s, p) => s + p.totalCost, 0);

  // Velocity from snapshots
  const velocityMap = snapshots.length > 0 ? calculateVelocity(snapshots) : new Map();

  // Build breakdown
  const productBreakdown: ProductBreakdownItem[] = Array.from(productMap.values())
    .map(p => {
      const vel = velocityMap.get(p.productName.toLowerCase().trim());
      return {
        productId: p.productId,
        productName: p.productName,
        unitsReceived: p.unitsReceived,
        unitCost: p.unitCost,
        totalCost: p.totalCost,
        percentOfSpend: totalSpend > 0 ? Math.round((p.totalCost / totalSpend) * 100) : 0,
        velocity: vel ? vel.unitsPerWeek : null,
        performanceStatus: vel ? vel.status : null,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  // Count movers
  let fastMovers = 0, slowMovers = 0, stagnantProducts = 0;
  productBreakdown.forEach(p => {
    if (p.performanceStatus === 'fast' || p.performanceStatus === 'healthy') fastMovers++;
    else if (p.performanceStatus === 'slow') slowMovers++;
    else if (p.performanceStatus === 'stagnant') stagnantProducts++;
  });

  // Justification (velocity-based, no sales data)
  let spendJustified: boolean | null = null;
  let justificationReason = 'Add sales report for full assessment';
  if (velocityMap.size > 0) {
    if (fastMovers > slowMovers + stagnantProducts) {
      spendJustified = true;
      justificationReason = 'Most products are fast or healthy movers';
    } else if (stagnantProducts > fastMovers) {
      spendJustified = false;
      justificationReason = 'High proportion of stagnant products';
    }
  }

  // Budget comparison
  let budgetVariance: number | null = null;
  let budgetVariancePercent: number | null = null;
  let overBudget = false;
  if (budgetAmount != null) {
    budgetVariance = totalSpend - budgetAmount;
    budgetVariancePercent = budgetAmount > 0 ? Math.round((budgetVariance / budgetAmount) * 100) : null;
    overBudget = totalSpend > budgetAmount;
  }

  // Previous period (same duration immediately before)
  const periodDuration = periodEnd.getTime() - periodStart.getTime();
  const prevStart = new Date(periodStart.getTime() - periodDuration);
  const prevEnd = new Date(periodStart.getTime() - 1);
  let previousPeriodSpend: number | null = null;
  let spendTrend: number | null = null;
  let spendTrendPercent: number | null = null;
  try {
    const prevStartTs = Timestamp.fromDate(prevStart);
    const prevEndTs = Timestamp.fromDate(prevEnd);
    const prevSeen = new Set<string>();
    const prevDocs: any[] = [];
    try {
      const ps1 = await getDocs(query(collection(db, 'venues', venueId, 'invoices'), where('supplierId', '==', supplierId), where('invoiceDateTimestamp', '>=', prevStartTs), where('invoiceDateTimestamp', '<=', prevEndTs)));
      for (const d of ps1.docs) { prevSeen.add(d.id); prevDocs.push({ id: d.id, ...d.data() }); }
    } catch {}
    try {
      const ps2 = await getDocs(query(collection(db, 'venues', venueId, 'invoices'), where('supplierId', '==', supplierId), where('date', '>=', prevStartTs), where('date', '<=', prevEndTs)));
      for (const d of ps2.docs) { if (!prevSeen.has(d.id)) { prevSeen.add(d.id); prevDocs.push({ id: d.id, ...d.data() }); } }
    } catch {}
    if (prevDocs.length > 0) {
      const prevMap = await sumInvoiceLines(venueId, prevDocs);
      previousPeriodSpend = Array.from(prevMap.values()).reduce((s, p) => s + p.totalCost, 0);
      spendTrend = totalSpend - previousPeriodSpend;
      spendTrendPercent = previousPeriodSpend > 0 ? Math.round((spendTrend / previousPeriodSpend) * 100) : null;
    }
  } catch {}

  return {
    supplierId,
    supplierName,
    period: { start: periodStart, end: periodEnd },
    totalSpend,
    invoiceCount: invoiceDocs.length,
    productCount: productMap.size,
    averageOrderValue: invoiceDocs.length > 0 ? totalSpend / invoiceDocs.length : 0,
    productBreakdown,
    hasSalesData: false,
    revenueFromProducts: null,
    grossMargin: null,
    marginPercent: null,
    budgetAmount,
    budgetVariance,
    budgetVariancePercent,
    overBudget,
    spendJustified,
    justificationReason,
    previousPeriodSpend,
    spendTrend,
    spendTrendPercent,
    fastMovers,
    slowMovers,
    stagnantProducts,
  };
}
