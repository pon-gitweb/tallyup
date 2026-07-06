/**
 * Hosti Health — Phase 1.
 * Stage 1 (before the first stocktake): a data-completeness checklist, no score.
 * Stage 2 (after the first stocktake): an honest, wide estimated score range
 * while confidence builds. Real variance-driven scoring lands in Phase 2.
 */
import { collection, doc, getDoc, getDocs, query, orderBy, limit, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { generateAbductiveInsights, AbductiveInsight } from './abductiveInsights';
import { generateStockoutPredictions, PredictionSummary } from './predictions';

export interface HostiHealthStage1 {
  stage: 1;
  progress: {
    hasProducts: boolean;       // productCount > 0
    hasCostPrices: boolean;     // at least 50% of products have costPrice > 0
    hasSuppliers: boolean;      // supplierCount > 0
    hasHourlyRate: boolean;     // venueSettings.hourlyRate exists
    hasFirstStocktake: boolean; // totalStocktakesCompleted >= 1
  };
  completedSteps: number;       // 0–5
  totalSteps: number;           // always 5
}

export interface HostiHealthStage2 {
  stage: 2;
  scoreMin: number;             // estimated range low
  scoreMax: number;             // estimated range high
  confidence: 'Very Low' | 'Building' | 'Medium' | 'High';
  completedStocktakes: number;
  stockValue: number | null;
}

export interface HostiHealthStage3 {
  stage: 3;
  score: number;           // 0–100, weighted composite
  label: 'Excellent' | 'Strong' | 'Developing' | 'Needs attention' | 'At risk';
  confidence: 'Very Low' | 'Building' | 'Medium' | 'High';
  trend: number | null;    // change vs previous month snapshot, null if no prior snapshot
  trendDirection: 'up' | 'down' | 'stable' | null;
  estimatedImpact: number | null;  // dollars recovered this cycle, null if no cost prices
  kpis: {
    stockAccuracy: number | null;    // 0–100 or null if no data
    labourEfficiency: number | null; // 0–100 or null if no hourlyRate or no segments
    inventoryHealth: number | null;  // 0–100 or null if < 2 monthly snapshots
    orderingIntelligence: number | null; // 0–100 or null if < 3 cycles
    wasteControl: null;              // always null — not yet built
  };
  completedStocktakes: number;
  stockValue: number | null;
  varianceDollars: number | null;
  daysOfCover: number | null;            // operational stock value ÷ daily consumption
  operationalStockValue: number | null;  // stock value excluding cellar/premium layers
  cellarStockValue: number | null;       // cellar + premium stock value, excluded from Days of Cover
  inventoryHealthUsedInvoiceData: boolean; // true if Days of Cover used real invoice totals, false if estimated from stock movement
  targetDaysOfCover: number;             // venue-configurable target, default 10
  orderingIntelligenceWeight: number;    // 0.05 / 0.10 / 0.15 depending on confidence
  paretoItems: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;  // negative = shortage, positive = excess
    varianceQty: number;
    contributionPct: number;  // this item's share of total absolute variance
  }>;
  paretoTop10?: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;
    contributionPct: number;
  }>;
  paretoTotalVariance: number;  // total absolute variance across all items
  paretoCoverageByTop3: number; // % of total variance covered by top 3 items (0–100)
  constraint: {
    type: 'frequency' | 'cost_completeness' | 'single_department' | null;
    description: string;           // one sentence, plain English
    impact: 'high' | 'medium' | 'low';
    fixAction: string;             // one sentence, what to do
  } | null;
  counterfactual: {
    scenario: string;              // "if you'd counted every 14 days instead of X..."
    estimatedAdditionalRecovery: number | null;  // dollars
    confidenceLabel: string;       // "Based on your last 2 cycles"
  } | null;
  abductiveInsights: AbductiveInsight[];
  predictions: PredictionSummary | null;
  calculatedAt: number;  // Date.now()
}

export type HostiHealthData = HostiHealthStage1 | HostiHealthStage2 | HostiHealthStage3;

export async function getHostiHealthStage(
  venueId: string,
  totalStocktakesCompleted: number,
  productCount: number,
  supplierCount: number,
  stockValue: number | null,
): Promise<HostiHealthData> {
  // Stage 1: fewer than 1 completed stocktake
  if (totalStocktakesCompleted < 1) {
    let hasHourlyRate = false;
    try {
      const labourSnap = await getDoc(doc(db, 'venues', venueId, 'settings', 'labour'));
      hasHourlyRate = typeof labourSnap.data()?.hourlyRate === 'number';
    } catch {
      // Non-fatal — treat as not configured
    }

    let hasCostPrices = false;
    try {
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const total = productsSnap.size;
      if (total > 0) {
        let priced = 0;
        productsSnap.forEach(d => {
          const costPrice = (d.data() as any)?.costPrice;
          if (typeof costPrice === 'number' && costPrice > 0) priced++;
        });
        hasCostPrices = priced / total >= 0.5;
      }
    } catch {
      // Non-fatal — treat as incomplete
    }

    const progress = {
      hasProducts: productCount > 0,
      hasCostPrices,
      hasSuppliers: supplierCount > 0,
      hasHourlyRate,
      hasFirstStocktake: totalStocktakesCompleted >= 1,
    };
    const completedSteps = Object.values(progress).filter(Boolean).length;

    return {
      stage: 1,
      progress,
      completedSteps,
      totalSteps: 5,
    };
  }

  // Stage 2: fewer than 3 completed stocktakes — honest wide range. All venues
  // start at 50–70; narrows into a real score once a 3rd stocktake lands.
  if (totalStocktakesCompleted < 3) {
    return {
      stage: 2,
      scoreMin: 50,
      scoreMax: 70,
      confidence: 'Building',
      completedStocktakes: totalStocktakesCompleted,
      stockValue,
    };
  }

  // Stage 3: 3+ completed stocktakes — real weighted score.
  return await calculateFullScore(venueId, totalStocktakesCompleted);
}

/**
 * Stage 3 — real score calculation.
 * Reads department snapshots, labour settings, and monthly profitRecoverySnapshots
 * to compute a weighted composite score. KPIs without enough data stay null and
 * their weight is redistributed across whichever KPIs ARE available, rather than
 * counted as zero — an unconfigured hourly rate should not drag the score down.
 */
async function calculateFullScore(
  venueId: string,
  totalStocktakesCompleted: number,
): Promise<HostiHealthStage3> {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  let avgCycleDays: number = 0; // lifted to function scope — populated by Inventory Health below, read by Constraint Analysis
  let targetDaysOfCover = 10; // lifted to function scope — populated by Labour Efficiency's labourSnap read, used by Inventory Health and Constraint Analysis

  // ── Stock Accuracy — latest snapshot per department, aggregated ──────────
  let totalVarianceDollars: number | null = null; // sum of absolute values per department — shortages and excesses both count
  let totalStockValueAgg: number | null = null;
  let pricedItemPercentSum = 0;
  let pricedItemPercentCount = 0;
  try {
    let anyHasPrices = false;
    let sumVariance = 0;
    let sumStockValue = 0;
    for (const deptDoc of deptsSnap.docs) {
      const snapsSnap = await getDocs(query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('cycleNumber', 'desc'),
        limit(1),
      ));
      if (snapsSnap.empty) continue;
      const snap = snapsSnap.docs[0].data() as any;
      if (snap?.dataCompleteness?.hasPrices) {
        anyHasPrices = true;
        // Sum absolute variance — shortages and excesses both count, don't cancel
        sumVariance += Math.abs(snap.summary?.totalVarianceDollars ?? 0);
        sumStockValue += snap.summary?.totalStockValue ?? 0;
      }
      // pricedItemPercent is stored 0–100 on the snapshot; average across depts for confidence.
      if (typeof snap?.dataCompleteness?.pricedItemPercent === 'number') {
        pricedItemPercentSum += snap.dataCompleteness.pricedItemPercent;
        pricedItemPercentCount++;
      }
    }
    if (anyHasPrices) {
      totalVarianceDollars = sumVariance;
      totalStockValueAgg = sumStockValue;
    }
  } catch {
    // Non-fatal — stockAccuracy stays null below
  }

  let stockAccuracy: number | null = null;
  if (totalStockValueAgg != null && totalStockValueAgg !== 0 && totalVarianceDollars != null) {
    // totalVarianceDollars is already a sum of absolute values — no Math.abs() needed here.
    const variancePct = totalVarianceDollars / totalStockValueAgg * 100;
    stockAccuracy = Math.min(95, Math.max(0, 100 - variancePct * 10));
  }

  // ── Pareto Analysis — which items drive the most variance ─────────────────
  let paretoItems: HostiHealthStage3['paretoItems'] = [];
  let paretoTotalVariance = 0;
  let paretoCoverageByTop3 = 0;
  try {
    const allVarianceItems: Array<{
      name: string; areaName: string | null; categoryName: string | null;
      varianceDollars: number; varianceQty: number;
    }> = [];

    // Reuse the department snapshots already fetched above
    for (const deptDoc of deptsSnap.docs) {
      const latestSnap = (await getDocs(query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('cycleNumber', 'desc'),
        limit(1),
      ))).docs[0];
      if (!latestSnap) continue;
      const snapData = latestSnap.data() as any;
      for (const item of (snapData.items || [])) {
        if (item.totalVarianceDollars == null) continue;
        if (item.totalVarianceDollars === 0) continue;
        allVarianceItems.push({
          name: item.name || 'Unknown product',
          areaName: item.areaName || null,
          categoryName: item.categoryName || null,
          varianceDollars: item.totalVarianceDollars,
          varianceQty: item.totalVarianceQty ?? 0,
        });
      }
    }

    // Sort by absolute variance descending — biggest impact first
    allVarianceItems.sort((a, b) => Math.abs(b.varianceDollars) - Math.abs(a.varianceDollars));

    const totalAbsVariance = allVarianceItems.reduce((s, i) => s + Math.abs(i.varianceDollars), 0);

    paretoItems = allVarianceItems.slice(0, 10).map(item => ({
      ...item,
      contributionPct: totalAbsVariance > 0
        ? Math.round(Math.abs(item.varianceDollars) / totalAbsVariance * 100)
        : 0,
    }));

    paretoTotalVariance = totalAbsVariance;
    paretoCoverageByTop3 = totalAbsVariance > 0
      ? Math.round(paretoItems.reduce((s, i) => s + Math.abs(i.varianceDollars), 0) / totalAbsVariance * 100)
      : 0;
  } catch {
    // Non-fatal — paretoItems stays empty below
  }

  // ── Labour Efficiency — sum activeCountingMinutes across all areas ───────
  let hasHourlyRate = false;
  let labourEfficiency: number | null = null;
  try {
    const labourSnap = await getDoc(doc(db, 'venues', venueId, 'settings', 'labour'));
    const labourData = labourSnap.exists() ? (labourSnap.data() as any) : null;
    const hourlyRate = typeof labourData?.hourlyRate === 'number' ? labourData.hourlyRate : null;
    const baselineMinutes = typeof labourData?.baselineMinutes === 'number' ? labourData.baselineMinutes : null;
    hasHourlyRate = hourlyRate != null;
    targetDaysOfCover = typeof labourData?.targetDaysOfCover === 'number'
      ? labourData.targetDaysOfCover
      : 10; // default: midpoint of 7–14 day NZ industry range

    let anySegmentData = false;
    let sumActiveMinutes = 0;
    for (const deptDoc of deptsSnap.docs) {
      const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'));
      areasSnap.forEach(areaDoc => {
        const ad = areaDoc.data() as any;
        if (typeof ad.activeCountingMinutes === 'number') {
          anySegmentData = true;
          sumActiveMinutes += ad.activeCountingMinutes;
        }
      });
    }

    if (hourlyRate != null && baselineMinutes != null && anySegmentData) {
      const savedMinutes = Math.max(0, baselineMinutes - sumActiveMinutes);
      labourEfficiency = Math.min(95, (savedMinutes / baselineMinutes) * 100);
    }
  } catch {
    // Non-fatal — labourEfficiency stays null below
  }

  // ── Inventory Health — Days of Cover ──────────────────────────────────────
  let inventoryHealth: number | null = null;
  let daysOfCover: number | null = null;
  let operationalStockValue: number | null = null;
  let cellarStockValue: number | null = null;
  let inventoryHealthUsedInvoiceData = false;

  try {
    // Step 1 — Classify products to separate operational vs cellar stock
    const { classifyVenueProducts, separateStockLayers } = await import('./classifyProducts');
    const classifications = await classifyVenueProducts(venueId);
    const layers = separateStockLayers(classifications);
    operationalStockValue = layers.operationalStockValue;
    cellarStockValue = layers.cellarStockValue + layers.premiumStockValue;

    // Step 2 — Get latest department snapshots for cycle duration and stock movement
    // Aggregate across all departments
    let totalCycledays = 0;
    let deptCount = 0;
    let prevCycleStockValue: number | null = null;
    let earliestCycleStart: Date | null = null;
    let latestCycleEnd: Date | null = null;

    for (const deptDoc of deptsSnap.docs) {
      const latestSnap = (await getDocs(
        query(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
          orderBy('cycleNumber', 'desc'),
          limit(1),
        ),
      )).docs[0];

      if (!latestSnap) continue;
      const snapData = latestSnap.data() as any;
      const days = snapData.daysSinceLastCycle;
      if (typeof days === 'number' && days > 0) {
        totalCycledays += days;
        deptCount++;
      }

      // Track the union of cycle windows across departments — used below to
      // look up actual invoices received during this cycle.
      const deptCycleStart = typeof snapData.cycleStart?.toDate === 'function' ? snapData.cycleStart.toDate() : null;
      const deptCycleEnd = typeof snapData.cycleEnd?.toDate === 'function' ? snapData.cycleEnd.toDate() : null;
      if (deptCycleStart && (earliestCycleStart == null || deptCycleStart < earliestCycleStart)) earliestCycleStart = deptCycleStart;
      if (deptCycleEnd && (latestCycleEnd == null || deptCycleEnd > latestCycleEnd)) latestCycleEnd = deptCycleEnd;

      // Get previous cycle for opening stock value
      const cycleNum = snapData.cycleNumber;
      if (cycleNum > 1) {
        const prevSnap = await getDoc(
          doc(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots', `cycle-${cycleNum - 1}`),
        );
        if (prevSnap.exists()) {
          const prev = prevSnap.data() as any;
          prevCycleStockValue = (prevCycleStockValue ?? 0) + (prev.summary?.totalStockValue ?? 0);
        }
      }
    }

    if (deptCount === 0 || operationalStockValue === 0) {
      // Not enough data — stay null
    } else {
      avgCycleDays = totalCycledays / deptCount;

      // Step 3 — Estimate daily consumption rate
      // consumption = openingValue - closingValue + purchasesValue
      const openingValue = prevCycleStockValue ?? operationalStockValue;
      const closingValue = operationalStockValue;

      // Attempt to get actual purchase value from invoice data for this cycle window
      let purchasesValue = 0;
      try {
        if (earliestCycleStart != null && latestCycleEnd != null) {
          const invoiceSnap = await getDocs(
            query(
              collection(db, 'venues', venueId, 'invoices'),
              where('invoiceDate', '>=', earliestCycleStart),
              where('invoiceDate', '<=', latestCycleEnd),
              limit(50),
            ),
          );
          if (!invoiceSnap.empty) {
            purchasesValue = invoiceSnap.docs.reduce((sum, d) => {
              const total = (d.data() as any)?.totalAmount;
              return sum + (typeof total === 'number' ? total : 0);
            }, 0);
            inventoryHealthUsedInvoiceData = purchasesValue > 0;
          }
        }
      } catch {
        // Non-fatal — fall through to implied purchases below
      }

      // Fall back to implied purchases if no invoice data
      // impliedPurchases approximated as max(0, closingValue - openingValue) when closing > opening
      if (!inventoryHealthUsedInvoiceData) {
        purchasesValue = Math.max(0, closingValue - openingValue);
      }

      const totalConsumed = openingValue - closingValue + purchasesValue;
      const dailyConsumption = avgCycleDays > 0 ? totalConsumed / avgCycleDays : 0;

      if (dailyConsumption > 0) {
        daysOfCover = Math.round(closingValue / dailyConsumption);

        // Step 4 — Score relative to the venue's target days of cover (default 10 days)
        // The healthy range is target ± 40% (so default 10 days = healthy range 6–14 days)
        const targetMin = Math.round(targetDaysOfCover * 0.6);
        const targetMax = Math.round(targetDaysOfCover * 1.4);

        inventoryHealth =
          daysOfCover < Math.round(targetMin * 0.6) ? 20 :  // critically lean
          daysOfCover < targetMin ? 45 + Math.round((daysOfCover / targetMin) * 20) : // lean
          daysOfCover <= targetMax ? Math.min(95, 70 + Math.round((1 - Math.abs(daysOfCover - targetDaysOfCover) / (targetMax - targetMin)) * 25)) : // healthy range scores 70–95
          daysOfCover <= Math.round(targetMax * 1.5) ? 65 : // moderately over-stocked
          daysOfCover <= Math.round(targetMax * 2) ? 45 : // over-stocked
          20; // significantly over-stocked
      }
    }
  } catch (e: any) {
    console.log('[hostiHealth] inventoryHealth calculation error:', e?.message);
    // Non-fatal — stays null
  }

  // ── Ordering Intelligence — line-level compliance rate, not binary acceptance ──
  // Orders created via the Suggested Orders screen already carry source:'suggestions'
  // (used for draft de-dupe in createFromSuggestions.ts) — reused here rather than
  // introducing a second, inconsistent value alongside it. Order lines always live
  // in the venues/{id}/orders/{orderId}/lines subcollection — confirmed there is no
  // parent-doc `lines` array in any live write path (createFromSuggestions.ts and
  // every reader use the subcollection; an old drafts.ts variant with an array field
  // is dead code, unreferenced from src/services/orders/index.ts).
  let orderingIntelligence: number | null = null;
  if (totalStocktakesCompleted >= 3) {
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
      const ordersSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'orders'),
          where('source', '==', 'suggestions'),
          where('createdAt', '>=', ninetyDaysAgo),
        ),
      );

      if (!ordersSnap.empty) {
        const complianceRates: number[] = [];

        for (const orderDoc of ordersSnap.docs) {
          const order = orderDoc.data() as any;
          const suggestedQtyMap = order.suggestedQtyMap as Record<string, number> | undefined;

          if (!suggestedQtyMap || Object.keys(suggestedQtyMap).length === 0) {
            // Old order without suggestedQtyMap — treat as 100% compliance (binary: they placed it)
            complianceRates.push(1.0);
            continue;
          }

          const linesSnap = await getDocs(
            collection(db, 'venues', venueId, 'orders', orderDoc.id, 'lines'),
          );
          const lines = linesSnap.docs.map(d => d.data() as { productId: string; qty: number });

          // Compute per-line compliance: min(orderedQty / suggestedQty, 1)
          // Ordering more than suggested = 1.0 (compliant), not penalised
          const lineCompliances: number[] = [];
          for (const [productId, suggestedQty] of Object.entries(suggestedQtyMap)) {
            if (suggestedQty <= 0) continue;
            const orderedLine = lines.find(l => l.productId === productId);
            const orderedQty = orderedLine?.qty ?? 0;
            lineCompliances.push(Math.min(1.0, orderedQty / suggestedQty));
          }

          if (lineCompliances.length > 0) {
            const avgCompliance = lineCompliances.reduce((s, c) => s + c, 0) / lineCompliances.length;
            complianceRates.push(avgCompliance);
          }
        }

        if (complianceRates.length > 0) {
          const avgRate = complianceRates.reduce((s, r) => s + r, 0) / complianceRates.length;
          // Max 90 — 100% blind compliance isn't ideal, leaves room for managerial judgment
          orderingIntelligence = Math.round(avgRate * 90);
        }
      }
    } catch (e: any) {
      console.log('[hostiHealth] orderingIntelligence error:', e?.message);
      // Non-fatal — stays null. Also covers the case where Firestore needs a
      // composite index (source ==, createdAt >=) that hasn't been created yet.
    }
  }

  // ── Confidence-aware Ordering Intelligence weight ─────────────────────────
  // If our velocity data is Low or Medium confidence, we shouldn't weight
  // this KPI heavily — our suggestions may not be reliable enough to penalise
  // a venue for not following them.
  // Low confidence (< 3 cycles): weight reduced to 5% effective
  // Medium confidence (3–5 cycles): weight reduced to 10% effective
  // High confidence (6+ cycles): full 15% weight
  let orderingIntelligenceWeight = 0.15;
  if (totalStocktakesCompleted < 3) {
    orderingIntelligenceWeight = 0.05;
  } else if (totalStocktakesCompleted < 6) {
    orderingIntelligenceWeight = 0.10;
  }
  // Redistribute the weight reduction to Stock Accuracy (most reliable KPI)
  const orderingWeightReduction = 0.15 - orderingIntelligenceWeight;

  // ── Waste Control — not yet built ────────────────────────────────────────
  const wasteControl: null = null;

  const kpis = { stockAccuracy, labourEfficiency, inventoryHealth, orderingIntelligence, wasteControl };

  // ── Weighted score with redistribution across whichever KPIs are available ──
  const weights: Record<string, number> = {
    stockAccuracy: 0.30 + orderingWeightReduction, // absorbs the ordering shortfall
    labourEfficiency: 0.20,
    inventoryHealth: 0.20,
    orderingIntelligence: orderingIntelligenceWeight,
    wasteControl: 0.15,
  };
  const available = Object.entries(kpis).filter(([, v]) => v !== null) as [string, number][];
  const totalWeight = available.reduce((s, [k]) => s + weights[k], 0);
  const score = available.length > 0
    ? Math.round(available.reduce((s, [k, v]) => s + (v * weights[k] / totalWeight), 0))
    : 0;

  const label: HostiHealthStage3['label'] =
    score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 60 ? 'Developing' : score >= 40 ? 'Needs attention' : 'At risk';

  // ── Trend — from previous calendar month snapshot ──
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7); // "2026-06"
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = prevMonthDate.toISOString().slice(0, 7);

  let trend: number | null = null;
  let trendDirection: 'up' | 'down' | 'stable' | null = null;
  try {
    const prevSnap = await getDoc(doc(db, 'venues', venueId, 'profitRecoverySnapshots', prevMonthKey));
    if (prevSnap.exists()) {
      const prevData = prevSnap.data() as any;
      const prevScore = typeof prevData?.score === 'number' ? prevData.score : null;
      if (prevScore != null) {
        trend = score - prevScore;
        trendDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable';
      }
    }
  } catch {
    // Non-fatal — trend stays null
  }

  // ── Previous cycle variance — from department snapshots, not calendar month ──
  // estimatedImpact appears after the 2nd stocktake regardless of whether both
  // happened in the same calendar month.
  let prevVarianceDollars: number | null = null;
  try {
    let prevCycleVarianceSum = 0;
    let prevCycleFound = false;

    for (const deptDoc of deptsSnap.docs) {
      const latestSnaps = await getDocs(
        query(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
          orderBy('cycleNumber', 'desc'),
          limit(1)
        )
      );
      if (latestSnaps.empty) continue;
      const latestData = latestSnaps.docs[0].data() as any;
      const currentCycleNumber = latestData.cycleNumber;
      if (!currentCycleNumber || currentCycleNumber < 2) continue;

      const prevCycleSnap = await getDoc(
        doc(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots', `cycle-${currentCycleNumber - 1}`)
      );
      if (!prevCycleSnap.exists()) continue;
      const prevCycleData = prevCycleSnap.data() as any;
      const prevVariance = prevCycleData?.summary?.totalVarianceDollars;
      if (typeof prevVariance === 'number') {
        prevCycleVarianceSum += Math.abs(prevVariance);
        prevCycleFound = true;
      }
    }

    if (prevCycleFound) {
      prevVarianceDollars = prevCycleVarianceSum;
    }
  } catch (e: any) {
    console.log('[hostiHealth] prevVarianceDollars error:', e?.message);
    // Non-fatal — stays null
  }

  // ── Estimated impact — reduction in variance dollars vs previous cycle ──
  const estimatedImpact = prevVarianceDollars != null && totalVarianceDollars != null
    ? Math.max(0, Math.abs(prevVarianceDollars) - Math.abs(totalVarianceDollars))
    : null;

  // ── Confidence ────────────────────────────────────────────────────────
  const pricedItemFraction = pricedItemPercentCount > 0
    ? (pricedItemPercentSum / pricedItemPercentCount) / 100
    : 0;
  let confidence = 0;
  if (totalStocktakesCompleted >= 3) confidence += 30;
  else if (totalStocktakesCompleted >= 1) confidence += 15;
  if (pricedItemFraction >= 0.5) confidence += 25;
  if (hasHourlyRate) confidence += 15;
  if (labourEfficiency !== null) confidence += 15;
  if (orderingIntelligence !== null) confidence += 15;
  const confidenceLabel: HostiHealthStage3['confidence'] =
    confidence >= 80 ? 'High' : confidence >= 60 ? 'Medium' : confidence >= 30 ? 'Building' : 'Very Low';

  // ── Constraint Analysis — identify the primary operational bottleneck ────────
  // Placed here (rather than right after Pareto) because it depends on avgCycleDays
  // (populated by Inventory Health, above) and pricedItemFraction (populated by
  // Confidence, just above) — both are only available by this point in the function.
  let constraint: HostiHealthStage3['constraint'] = null;
  let counterfactual: HostiHealthStage3['counterfactual'] = null;

  try {
    // Rank constraints by impact — find the biggest single lever

    // Constraint 1 — Stocktake frequency (most common constraint)
    // Healthy = every 7–14 days by default. Over 21 days = meaningful gap.
    // Use targetDaysOfCover as context for constraint messaging — a venue
    // targeting 5 days of cover should count more frequently than one targeting 14.
    if (avgCycleDays > 21) {
      const impact: 'high' | 'medium' | 'low' = avgCycleDays > 45 ? 'high' : avgCycleDays > 28 ? 'medium' : 'low';
      const recommendedCycleFrequency = targetDaysOfCover <= 7 ? 7 : targetDaysOfCover <= 14 ? 14 : 21;
      constraint = {
        type: 'frequency',
        description: `Your stocktakes are happening every ${Math.round(avgCycleDays)} days. Based on your ${targetDaysOfCover}-day stock target, counting every ${recommendedCycleFrequency} days would give you better visibility.`,
        impact,
        fixAction: `Increase stocktake frequency to every ${recommendedCycleFrequency} days to match your stock holding target.`,
      };

      // Counterfactual: if you'd counted every recommendedCycleFrequency days instead...
      // Variance detected later = more time for leakage to accumulate.
      // Conservative estimate: variance scales linearly with detection lag.
      // Always set when frequency is the constraint — estimatedAdditionalRecovery
      // stays null (rather than skipping the card) when there's no cost-price data.
      if (avgCycleDays > recommendedCycleFrequency) {
        let estimatedAdditionalRecovery: number | null = null;
        if (totalVarianceDollars != null) {
          const lagFactor = recommendedCycleFrequency / avgCycleDays; // proportion of cycle if counted more frequently
          estimatedAdditionalRecovery = Math.round(Math.abs(totalVarianceDollars) * (1 - lagFactor));
        }
        counterfactual = {
          scenario: `If you'd counted every ${recommendedCycleFrequency} days instead of every ${Math.round(avgCycleDays)} days`,
          estimatedAdditionalRecovery,
          confidenceLabel: `Based on your last ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''}`,
        };
      }
    }

    // Constraint 2 — Cost price completeness (if frequency is fine)
    // If frequency is OK but scores are low-confidence, missing prices are the bottleneck
    if (constraint === null && pricedItemFraction < 0.5) {
      constraint = {
        type: 'cost_completeness',
        description: `Less than half your products have cost prices — your financial impact calculations are estimates only.`,
        impact: 'medium',
        fixAction: 'Add cost prices to your products to unlock accurate stock value, variance dollar amounts, and ROI calculations.',
      };
      // No counterfactual for this constraint — hard to estimate dollar impact of missing prices
    }

    // Constraint 3 — Only one department (limits cross-department insights)
    if (constraint === null && deptsSnap.docs.length === 1) {
      constraint = {
        type: 'single_department',
        description: 'You have one department. Adding separate departments (e.g. Bar, Kitchen, Cellar) gives you area-specific variance tracking.',
        impact: 'low',
        fixAction: 'Add departments in Settings to track variance by area and identify where leakage is occurring.',
      };
    }
  } catch (e: any) {
    console.log('[hostiHealth] constraint analysis error:', e?.message);
    // Non-fatal
  }

  const stockValueResolved = totalStockValueAgg;

  // ── Abductive Insights — pattern matching over the values computed above ──
  let abductiveInsights: AbductiveInsight[] = [];
  try {
    abductiveInsights = generateAbductiveInsights({
      totalVarianceDollars,
      prevVarianceDollars,
      stockAccuracy,
      labourEfficiency,
      inventoryHealth,
      avgCycleDays,
      totalStocktakesCompleted,
      pricedItemFraction,
      paretoItems,
      daysOfCover,
      operationalStockValue,
    });
  } catch (e: any) {
    console.log('[hostiHealth] abductive insights error:', e?.message);
    abductiveInsights = [];
  }

  // ── Stockout Predictions — pure arithmetic, needs real velocity data ──────
  let predictions: HostiHealthStage3['predictions'] = null;
  try {
    if (totalStocktakesCompleted >= 2) {
      predictions = await generateStockoutPredictions(venueId, avgCycleDays);
    }
  } catch (e: any) {
    console.log('[hostiHealth] predictions error:', e?.message);
    // Non-fatal
  }

  // ── Monthly snapshot write — non-fatal, score still returns if it fails ──
  try {
    await setDoc(doc(db, 'venues', venueId, 'profitRecoverySnapshots', monthKey), {
      score,
      confidence: confidenceLabel,
      kpiScores: kpis,
      estimatedImpact,
      stockValue: stockValueResolved,
      varianceDollars: totalVarianceDollars,
      calculatedAt: Date.now(),
      // Pareto top 10 variance drivers for Command Centre group view
      paretoTop10: paretoItems.slice(0, 10).map(p => ({
        name: p.name,
        varianceDollars: p.varianceDollars,
        contributionPct: p.contributionPct,
        areaName: p.areaName || null,
        categoryName: p.categoryName || null,
      })),
      // Pareto top 3 for Suitee context and mobile Performance screen
      paretoTop3: paretoItems.slice(0, 3).map(p => ({
        name: p.name,
        varianceDollars: p.varianceDollars,
        contributionPct: p.contributionPct,
        areaName: p.areaName || null,
        categoryName: p.categoryName || null,
      })),
      paretoTotalVariance: paretoTotalVariance ?? null,
      // NEW — top abductive insight for Suitee context
      topInsight: abductiveInsights[0] ? {
        pattern: abductiveInsights[0].pattern,
        mostLikelyExplanation: abductiveInsights[0].mostLikelyExplanation,
        confidence: abductiveInsights[0].confidence,
        confidenceLabel: abductiveInsights[0].confidenceLabel,
        actionable: abductiveInsights[0].actionable,
        severity: abductiveInsights[0].severity,
      } : null,
      // NEW — primary operational constraint for Suitee context
      constraintType: constraint?.type ?? null,
      constraintDescription: constraint?.description ?? null,
      constraintFixAction: constraint?.fixAction ?? null,
      constraintImpact: constraint?.impact ?? null,
      // NEW — Days of Cover for Suitee context
      daysOfCover: daysOfCover ?? null,
      targetDaysOfCover: targetDaysOfCover ?? null,
      operationalStockValue: operationalStockValue ?? null,
      cellarStockValue: cellarStockValue ?? null,
    }, { merge: true });
  } catch {
    // Non-fatal — score still returns if write fails
  }

  return {
    stage: 3,
    score,
    label,
    confidence: confidenceLabel,
    trend,
    trendDirection,
    estimatedImpact,
    kpis,
    completedStocktakes: totalStocktakesCompleted,
    stockValue: stockValueResolved,
    varianceDollars: totalVarianceDollars,
    daysOfCover,
    operationalStockValue,
    cellarStockValue,
    inventoryHealthUsedInvoiceData,
    targetDaysOfCover,
    orderingIntelligenceWeight,
    paretoItems,
    paretoTotalVariance,
    paretoCoverageByTop3,
    constraint,
    counterfactual,
    abductiveInsights,
    predictions,
    calculatedAt: Date.now(),
  };
}
