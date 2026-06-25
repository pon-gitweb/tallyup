// @ts-nocheck
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { computeVarianceSnapshot } from './variance';
import { assessDataQuality } from './dataQuality';

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

  // 3) Sales (venue-level)
  try {
    const salesCol = collection(db, 'venues', venueId, 'sales');
    const qSales = query(
      salesCol,
      where('createdAt', '>=', from),
      // loose where: any status is fine; we only care about totals here
    );
    const salesSnap = await getDocs(qSales);
    result.sales.docs = salesSnap.size;

    let totalNet = 0;
    for (const s of salesSnap.docs) {
      const sd: any = s.data() || {};
      // Try several common fields for net sales
      const val =
        typeof sd.netSales === 'number'
          ? sd.netSales
          : typeof sd.total === 'number'
          ? sd.total
          : typeof sd.revenue === 'number'
          ? sd.revenue
          : null;
      if (typeof val === 'number') totalNet += val;
    }
    result.sales.totalNetSales = salesSnap.size > 0 ? totalNet : null;
  } catch (e: any) {
    // Sales docs will remain 0; dataQuality will flag GP as limited.
  }

  // 4) Spend from invoices
  try {
    const invCol = collection(db, 'venues', venueId, 'invoices');
    const qInv = query(invCol, where('createdAt', '>=', from));
    const invSnap = await getDocs(qInv);
    result.spend.docs = invSnap.size;

    let totalSpend = 0;
    for (const inv of invSnap.docs) {
      const id: any = inv.data() || {};
      const val =
        typeof id.total === 'number'
          ? id.total
          : typeof id.grandTotal === 'number'
          ? id.grandTotal
          : typeof id.netTotal === 'number'
          ? id.netTotal
          : null;
      if (typeof val === 'number') totalSpend += val;
    }
    result.spend.totalSpend = invSnap.size > 0 ? totalSpend : null;
  } catch (e: any) {
    // Spend docs will stay 0; dataQuality will call this out.
  }

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
