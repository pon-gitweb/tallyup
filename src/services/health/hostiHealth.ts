// @ts-nocheck
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
  paretoItems: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;  // negative = shortage, positive = excess
    varianceQty: number;
    contributionPct: number;  // this item's share of total absolute variance
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

  // Stage 2: exactly 1 completed stocktake — honest wide range. All venues
  // start at 50–70; narrows into a real score once a 2nd stocktake lands.
  if (totalStocktakesCompleted < 2) {
    return {
      stage: 2,
      scoreMin: 50,
      scoreMax: 70,
      confidence: 'Building',
      completedStocktakes: totalStocktakesCompleted,
      stockValue,
    };
  }

  // Stage 3: 2+ completed stocktakes — real weighted score.
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

  // ── Stock Accuracy — latest snapshot per department, aggregated ──────────
  let totalVarianceDollars: number | null = null;
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
        sumVariance += snap.summary?.totalVarianceDollars ?? 0;
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
    const variancePct = Math.abs(totalVarianceDollars) / totalStockValueAgg * 100;
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

    paretoItems = allVarianceItems.slice(0, 3).map(item => ({
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
      // consumption = openingValue - closingValue + impliedPurchases
      // impliedPurchases approximated as max(0, closingValue - openingValue) when closing > opening
      const openingValue = prevCycleStockValue ?? operationalStockValue;
      const closingValue = operationalStockValue;
      const impliedPurchases = Math.max(0, closingValue - openingValue);
      const totalConsumed = openingValue - closingValue + impliedPurchases;
      const dailyConsumption = avgCycleDays > 0 ? totalConsumed / avgCycleDays : 0;

      if (dailyConsumption > 0) {
        daysOfCover = Math.round(closingValue / dailyConsumption);

        // Step 4 — Score against Days of Cover benchmarks
        // NZ hospitality healthy range: 7–14 days
        inventoryHealth =
          daysOfCover < 3  ? 20 :
          daysOfCover < 5  ? 45 :
          daysOfCover < 7  ? 65 :
          daysOfCover <= 14 ? Math.min(95, 70 + (daysOfCover - 7) * 3.5) : // 70–94.5 in healthy range
          daysOfCover <= 21 ? 65 :
          daysOfCover <= 30 ? 45 :
          20; // > 30 days: significantly over-stocked
      }
    }
  } catch (e: any) {
    console.log('[hostiHealth] inventoryHealth calculation error:', e?.message);
    // Non-fatal — stays null
  }

  // ── Ordering Intelligence — acceptance rate of suggested orders ──────────
  // Orders created via the Suggested Orders screen already carry source:'suggestions'
  // (used for draft de-dupe in createFromSuggestions.ts) — reused here rather than
  // introducing a second, inconsistent value alongside it.
  let orderingIntelligence: number | null = null;
  if (totalStocktakesCompleted >= 3) {
    try {
      const ninetyDaysAgo = Date.now() - 90 * 86400000;
      const ordersSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'orders'),
          where('source', '==', 'suggestions'),
          where('createdAt', '>=', new Date(ninetyDaysAgo)),
        ),
      );
      // Acceptance rate: orders placed from suggestions / expected cycles in window.
      // A venue doing 1 stocktake/month should place ~3 suggested orders in 90 days.
      const placed = ordersSnap.size;
      const expectedCycles = Math.min(totalStocktakesCompleted, 3);
      const acceptanceRate = Math.min(1, placed / expectedCycles);
      orderingIntelligence = Math.round(acceptanceRate * 90); // max 90 — 100% blind acceptance isn't ideal
    } catch {
      // Non-fatal — stays null. Also covers the case where Firestore needs a
      // composite index (source ==, createdAt >=) that hasn't been created yet.
    }
  }

  // ── Waste Control — not yet built ────────────────────────────────────────
  const wasteControl: null = null;

  const kpis = { stockAccuracy, labourEfficiency, inventoryHealth, orderingIntelligence, wasteControl };

  // ── Weighted score with redistribution across whichever KPIs are available ──
  const weights: Record<string, number> = {
    stockAccuracy: 0.30, labourEfficiency: 0.20, inventoryHealth: 0.20,
    orderingIntelligence: 0.15, wasteControl: 0.15,
  };
  const available = Object.entries(kpis).filter(([, v]) => v !== null) as [string, number][];
  const totalWeight = available.reduce((s, [k]) => s + weights[k], 0);
  const score = available.length > 0
    ? Math.round(available.reduce((s, [k, v]) => s + (v * weights[k] / totalWeight), 0))
    : 0;

  const label: HostiHealthStage3['label'] =
    score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 60 ? 'Developing' : score >= 40 ? 'Needs attention' : 'At risk';

  // ── Trend + previous-cycle variance — explicit previous calendar month ──
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7); // "2026-06"
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = prevMonthDate.toISOString().slice(0, 7);

  let trend: number | null = null;
  let trendDirection: 'up' | 'down' | 'stable' | null = null;
  let prevVarianceDollars: number | null = null;
  try {
    const prevSnap = await getDoc(doc(db, 'venues', venueId, 'profitRecoverySnapshots', prevMonthKey));
    if (prevSnap.exists()) {
      const prevData = prevSnap.data() as any;
      const prevScore = typeof prevData?.score === 'number' ? prevData.score : null;
      prevVarianceDollars = typeof prevData?.varianceDollars === 'number' ? prevData.varianceDollars : null;
      if (prevScore != null) {
        trend = score - prevScore;
        trendDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable';
      }
    }
  } catch {
    // Non-fatal — trend stays null below
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
    // Healthy = every 7–14 days. Over 21 days = meaningful gap.
    if (avgCycleDays > 21) {
      const impact: 'high' | 'medium' | 'low' = avgCycleDays > 45 ? 'high' : avgCycleDays > 28 ? 'medium' : 'low';
      constraint = {
        type: 'frequency',
        description: `Your stocktakes are happening every ${Math.round(avgCycleDays)} days on average. The optimal range for NZ hospitality is 7–14 days.`,
        impact,
        fixAction: `Increase your stocktake frequency to at least every ${avgCycleDays > 45 ? '14' : '21'} days to catch variance earlier.`,
      };

      // Counterfactual: if you'd counted every 14 days instead...
      // Variance detected later = more time for leakage to accumulate.
      // Conservative estimate: variance scales linearly with detection lag.
      // Always set when frequency is the constraint — estimatedAdditionalRecovery
      // stays null (rather than skipping the card) when there's no cost-price data.
      if (avgCycleDays > 14) {
        let estimatedAdditionalRecovery: number | null = null;
        if (totalVarianceDollars != null) {
          const lagFactor = 14 / avgCycleDays; // proportion of cycle if counted more frequently
          estimatedAdditionalRecovery = Math.round(Math.abs(totalVarianceDollars) * (1 - lagFactor));
        }
        counterfactual = {
          scenario: `If you'd counted every 14 days instead of every ${Math.round(avgCycleDays)} days`,
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
