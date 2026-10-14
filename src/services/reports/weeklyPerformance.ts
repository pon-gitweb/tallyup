import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { computeVarianceSnapshot } from './variance';
import { assessDataQuality } from './dataQuality';
import {
  partitionReports,
  toNZDate,
  weekMonday,
  type ActiveReport,
} from '../../utils/weeklyLedger';

export type WeeklyPerformanceSummary = {
  venueName: string | null;
  windowLabel: string;
  // Stocktake coverage
  stock: {
    departments: number;
    areasTotal: number;
    areasCompleted: number;
    areasInProgress: number;
    lastCompletedAt: Date | null;
    totalStocktakesCompleted: number;
  };
  // Sales over the window
  sales: {
    docs: number;
    totalNetSales: number | null;
    source: 'sales_reports' | 'legacy' | null;
    gstLabel: string | null;
    weeksCovered: number;
  };
  // Spend from invoices
  spend: {
    docs: number;
    totalSpend: number | null;
  };
  // GP (venue-level)
  gp: {
    expected: number | null;
    landed: number | null;
    actual: number | null;
  };
  // Shrinkage / variance
  variance: {
    totalShortageValue: number | null;
    totalExcessValue: number | null;
    totalShrinkValue: number | null;
  };
  // Latest stock-take session info (for previews)
  stockSessions: {
    latestCompletedAt: any | null;
    status: string | null;
  } | null;
  // Data quality flags for honesty
  flags: string[];
};

/**
 * We treat "weekly" as the last 7 days.
 * This function is deliberately defensive: any query failures are caught
 * and reported as flags via assessDataQuality rather than crashing.
 */
export async function loadWeeklyPerformance(
  venueId: string,
): Promise<WeeklyPerformanceSummary> {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowLabel = 'Last 7 days';

  const result: WeeklyPerformanceSummary = {
    venueName: null,
    windowLabel,
    stock: {
      departments: 0,
      areasTotal: 0,
      areasCompleted: 0,
      areasInProgress: 0,
      lastCompletedAt: null,
      totalStocktakesCompleted: 0,
    },
    sales: {
      docs: 0,
      totalNetSales: null,
      source: null,
      gstLabel: null,
      weeksCovered: 0,
    },
    spend: {
      docs: 0,
      totalSpend: null,
    },
    gp: {
      expected: null,
      landed: null,
      actual: null,
    },
    variance: {
      totalShortageValue: null,
      totalExcessValue: null,
      totalShrinkValue: null,
    },
    stockSessions: null,
    flags: [],
  };

  // 1) Venue name + total stocktakes completed (one read, two fields)
  try {
    const venSnap = await getDoc(doc(db, 'venues', venueId));
    if (venSnap.exists()) {
      const vd: any = venSnap.data() || {};
      result.venueName = vd.name || vd.venueName || null;
      result.stock.totalStocktakesCompleted =
        typeof vd.totalStocktakesCompleted === 'number' ? vd.totalStocktakesCompleted : 0;
    }
  } catch (e: any) {
    // Name is nice-to-have; we report issues through data quality later.
  }

  // 2) Stocktake coverage: departments + cycle history.
  // Live area docs (completedAt) are cleared on reset, so reading them directly
  // would show 0/N completed even right after a full stocktake. Instead, read each
  // department's most recent entry in its `cycles` history subcollection — that
  // record survives reset and tells us what was actually completed, and when.
  try {
    const deptCol = collection(db, 'venues', venueId, 'departments');
    const deptSnap = await getDocs(deptCol);
    let areasTotal = 0;
    let areasCompleted = 0;
    // areasInProgress can't be derived from cycle history (it's a transient,
    // in-the-moment state) — left at 0 now that we no longer read live area docs.
    const areasInProgress = 0;
    let lastCompletedAt: Date | null = null;

    for (const d of deptSnap.docs) {
      const deptId = d.id;
      // Read the most recent completed cycle for this department
      const cyclesSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'departments', deptId, 'cycles'),
          orderBy('completedAt', 'desc'),
          limit(1),
        ),
      );
      if (cyclesSnap.docs.length > 0) {
        const lastCycle = cyclesSnap.docs[0].data() as any;
        const completedAt = lastCycle.completedAt?.toDate?.() || null;
        if (completedAt && (!lastCompletedAt || completedAt > lastCompletedAt)) {
          lastCompletedAt = completedAt;
        }
        // Only count as completed if within the 7-day window
        if (completedAt && completedAt >= from) {
          areasCompleted += lastCycle.areaCount || 1;
          areasTotal += lastCycle.areaCount || 1;
        }
      }
    }

    result.stock.departments = deptSnap.size;
    result.stock.areasTotal = areasTotal;
    result.stock.areasCompleted = areasCompleted;
    result.stock.areasInProgress = areasInProgress;
    result.stock.lastCompletedAt = lastCompletedAt;
  } catch (e: any) {
    // If this fails, stock coverage stays zero; dataQuality will call that out.
  }

  // 3) Sales — try active salesReports for last complete week first
  const todayNZ = toNZDate(new Date()) ?? now.toISOString().slice(0, 10);
  const currentWkMon = weekMonday(todayNZ);
  const lastWkMonMs = new Date(currentWkMon + 'T00:00:00Z').getTime() - 7 * 86_400_000;
  const lastWkMonStr = new Date(lastWkMonMs).toISOString().slice(0, 10);
  const lastWkSunStr = new Date(lastWkMonMs + 6 * 86_400_000).toISOString().slice(0, 10);

  let salesLoaded = false;
  try {
    const reportsSnap = await getDocs(collection(db, 'venues', venueId, 'salesReports'));
    const { reports: activeReports } = partitionReports(reportsSnap.docs as any);

    // Find reports that overlap the last complete week
    const overlapping = activeReports.filter(r =>
      r.startStr && r.endStr && r.startStr <= lastWkSunStr && r.endStr >= lastWkMonStr
    );

    if (overlapping.length > 0) {
      let totalRevenue = 0;
      let hasExGst = false;
      let hasInclGst = false;
      const weeksSet = new Set<string>();

      for (const r of overlapping) {
        const reportDays = r.days ?? 1;
        const overlapStart = r.startStr! > lastWkMonStr ? r.startStr! : lastWkMonStr;
        const overlapEnd = r.endStr! < lastWkSunStr ? r.endStr! : lastWkSunStr;
        const overlapDays = Math.round(
          (new Date(overlapEnd + 'T00:00:00Z').getTime() - new Date(overlapStart + 'T00:00:00Z').getTime()) / 86_400_000
        ) + 1;
        const frac = overlapDays / reportDays;

        // Revenue: prefer netExcl (ex GST), fall back to grossIncl / gross
        let reportRevenue = 0;
        let reportExGst = false;
        for (const line of r.rawLines) {
          if (typeof line.netExcl === 'number') {
            reportRevenue += line.netExcl;
            reportExGst = true;
          } else {
            reportRevenue += line.grossIncl ?? line.gross ?? 0;
          }
        }
        totalRevenue += reportRevenue * frac;
        if (reportExGst) hasExGst = true; else hasInclGst = true;
        if (r.startStr) weeksSet.add(r.startStr.slice(0, 7));
      }

      result.sales.totalNetSales = totalRevenue;
      result.sales.source = 'sales_reports';
      result.sales.gstLabel = hasExGst && !hasInclGst ? 'excl GST' : 'incl GST';
      result.sales.weeksCovered = weeksSet.size;
      result.sales.docs = overlapping.length;
      salesLoaded = true;
    }
  } catch { /* fall through to legacy */ }

  // Legacy sales collection fallback
  if (!salesLoaded) {
    try {
      const qSales = query(
        collection(db, 'venues', venueId, 'sales'),
        where('createdAt', '>=', from),
      );
      const salesSnap = await getDocs(qSales);
      result.sales.docs = salesSnap.size;
      let totalNet = 0;
      for (const s of salesSnap.docs) {
        const sd: any = s.data() || {};
        const val =
          typeof sd.netSales === 'number' ? sd.netSales :
          typeof sd.total === 'number' ? sd.total :
          typeof sd.revenue === 'number' ? sd.revenue : null;
        if (typeof val === 'number') totalNet += val;
      }
      if (salesSnap.size > 0) {
        result.sales.totalNetSales = totalNet;
        result.sales.source = 'legacy';
      }
    } catch { /* sales stays null */ }
  }

  // 4) Spend from invoices — invoiceDateTimestamp range (single-field, no composite index)
  try {
    const startTs = Timestamp.fromDate(from);
    const endTs = Timestamp.fromDate(now);
    const invSnap = await getDocs(query(
      collection(db, 'venues', venueId, 'invoices'),
      where('invoiceDateTimestamp', '>=', startTs),
      where('invoiceDateTimestamp', '<=', endTs),
    ));
    result.spend.docs = invSnap.size;
    let totalSpend = 0;
    for (const inv of invSnap.docs) {
      const id: any = inv.data() || {};
      const val =
        typeof id.totalAmount === 'number' ? id.totalAmount :
        typeof id.total === 'number' ? id.total :
        typeof id.grandTotal === 'number' ? id.grandTotal : null;
      if (typeof val === 'number') totalSpend += val;
    }
    result.spend.totalSpend = invSnap.size > 0 ? totalSpend : null;
  } catch { /* spend stays null */ }

  // 5) Variance / shrinkage (reuse computeVarianceSnapshot)
  try {
    const variance = await computeVarianceSnapshot(venueId);
    const shortages = Array.isArray(variance.shortages)
      ? variance.shortages
      : [];
    const excesses = Array.isArray(variance.excesses)
      ? variance.excesses
      : [];

    let shortageVal = 0;
    for (const r of shortages) {
      const v: any = r;
      if (typeof v.value === 'number' && v.value < 0) {
        shortageVal += Math.abs(v.value);
      }
    }

    let excessVal = 0;
    for (const r of excesses) {
      const v: any = r;
      if (typeof v.value === 'number' && v.value > 0) {
        excessVal += v.value;
      }
    }

    result.variance.totalShortageValue =
      shortageVal > 0 ? shortageVal : null;
    result.variance.totalExcessValue = excessVal > 0 ? excessVal : null;

    if (shortageVal > 0 || excessVal > 0) {
      result.variance.totalShrinkValue = shortageVal + excessVal;
    } else {
      result.variance.totalShrinkValue = null;
    }
  } catch (e: any) {
    // Variance stays null; dataQuality will say it's not available.
  }

  // 6) GP – coarse venue-level GP based on sales vs spend
  if (
    typeof result.sales.totalNetSales === 'number' &&
    typeof result.spend.totalSpend === 'number'
  ) {
    const sales = result.sales.totalNetSales;
    const cogs = result.spend.totalSpend;
    if (sales > 0 && cogs >= 0) {
      const actualGp = ((sales - cogs) / sales) * 100;
      result.gp.actual = Math.round(actualGp * 10) / 10;
    }
  }

  // Expected and landed GP will come from richer product+recipe data in a later pass.
  // For now we leave them null so the UI can explain that to the user.

  // 7) Latest stock-take session (for "Completed stock takes" preview)
  try {
    const sessRef = doc(db, 'venues', venueId, 'sessions', 'current');
    const sessSnap = await getDoc(sessRef);
    if (sessSnap.exists()) {
      const sv: any = sessSnap.data() || {};
      result.stockSessions = {
        latestCompletedAt: sv.completedAt || null,
        status: sv.status || null,
      };
    }
  } catch (e: any) {
    // If this fails we just leave stockSessions as null.
  }

  // 8) Data quality assessment (single source of truth for honesty flags)
  const quality = assessDataQuality({
    stock: result.stock,
    sales: result.sales,
    spend: result.spend,
    variance: result.variance,
  });

  result.flags = quality.flags;

  return result;
}
