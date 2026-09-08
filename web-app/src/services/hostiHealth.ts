/**
 * Hosti Health — Phase 1.
 * Stage 1 (before the first stocktake): a data-completeness checklist, no score.
 * Stage 2 (after the first stocktake): an honest, wide estimated score range
 * while confidence builds. Real variance-driven scoring lands in Phase 2.
 *
 * Web-app port of src/services/health/hostiHealth.ts.
 * Adaptations from the mobile original:
 *   1. db imported from ../firebase (web-app instance)
 *   2. All diagnostic Alert.alert and debug/checkpoint writes removed
 *   3. captureError/captureMessage replaced with console.error/console.info
 */
import { collection, doc, getDoc, getDocs, query, orderBy, limit, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { generateAbductiveInsights } from './abductiveInsights';
import type { AbductiveInsight } from './abductiveInsights';
import { generateStockoutPredictions } from './predictions';
import type { PredictionSummary } from './predictions';

export interface HostiHealthStage1 {
  stage: 1;
  progress: {
    hasProducts: boolean;
    hasCostPrices: boolean;
    hasSuppliers: boolean;
    hasHourlyRate: boolean;
    hasFirstStocktake: boolean;
  };
  completedSteps: number;
  totalSteps: number;
}

export interface HostiHealthStage2 {
  stage: 2;
  scoreMin: number;
  scoreMax: number;
  confidence: 'Very Low' | 'Building' | 'Medium' | 'High';
  completedStocktakes: number;
  stockValue: number | null;
}

export interface HostiHealthStage3 {
  stage: 3;
  score: number;
  label: 'Excellent' | 'Strong' | 'Developing' | 'Needs attention' | 'At risk';
  confidence: 'Very Low' | 'Building' | 'Medium' | 'High';
  trend: number | null;
  trendDirection: 'up' | 'down' | 'stable' | null;
  estimatedImpact: number | null;
  kpis: {
    stockAccuracy: number | null;
    labourEfficiency: number | null;
    inventoryHealth: number | null;
    orderingIntelligence: number | null;
    wasteControl: number | null;
    wasteControlMode: 'stock_integrity' | 'waste_control' | null;
    wasteControlLabel: string | null;
  };
  completedStocktakes: number;
  stockValue: number | null;
  varianceDollars: number | null;
  daysOfCover: number | null;
  operationalStockValue: number | null;
  cellarStockValue: number | null;
  inventoryHealthUsedInvoiceData: boolean;
  targetDaysOfCover: number;
  orderingIntelligenceWeight: number;
  paretoItems: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;
    varianceQty: number;
    contributionPct: number;
  }>;
  paretoTop10?: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;
    contributionPct: number;
  }>;
  paretoTotalVariance: number;
  paretoCoverageByTop3: number;
  constraint: {
    type: 'frequency' | 'cost_completeness' | 'single_department' | null;
    description: string;
    impact: 'high' | 'medium' | 'low';
    fixAction: string;
  } | null;
  counterfactual: {
    scenario: string;
    estimatedAdditionalRecovery: number | null;
    confidenceLabel: string;
  } | null;
  abductiveInsights: AbductiveInsight[];
  predictions: PredictionSummary | null;
  calculatedAt: number;
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
    } catch (e: any) {
      console.error('hostiHealth:stage1:labourSettings', e);
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
    } catch (e: any) {
      console.error('hostiHealth:stage1:costPrices', e);
    }

    const progress = {
      hasProducts: productCount > 0,
      hasCostPrices,
      hasSuppliers: supplierCount > 0,
      hasHourlyRate,
      hasFirstStocktake: totalStocktakesCompleted >= 1,
    };
    const completedSteps = Object.values(progress).filter(Boolean).length;

    return { stage: 1, progress, completedSteps, totalSteps: 5 };
  }

  // Stage 2: fewer than 3 completed stocktakes
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
 */
async function calculateFullScore(
  venueId: string,
  totalStocktakesCompleted: number,
): Promise<HostiHealthStage3> {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  let avgCycleDays: number = 0;
  let targetDaysOfCover = 10;

  // ── Stock Accuracy ────────────────────────────────────────────────────────
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
      if (snap?.dataCompleteness?.hasPrices || (snap.summary?.displayTotalStockValue ?? 0) > 0) {
        anyHasPrices = true;
        sumVariance += Math.abs((snap.summary?.displayTotalVarianceDollars ?? snap.summary?.totalVarianceDollars) ?? 0);
        sumStockValue += (snap.summary?.displayTotalStockValue ?? snap.summary?.totalStockValue) ?? 0;
      }
      if (typeof snap?.dataCompleteness?.pricedItemPercent === 'number') {
        const stampedPct = snap.dataCompleteness.pricedItemPercent;
        const invoiceVerifiedCount = typeof snap.summary?.itemsPricedByInvoice === 'number'
          ? snap.summary.itemsPricedByInvoice : 0;
        const totalCounted = typeof snap.summary?.totalItemsCounted === 'number'
          ? snap.summary.totalItemsCounted : 0;
        const displayPct = totalCounted > 0
          ? Math.min(100, stampedPct + (invoiceVerifiedCount / totalCounted) * 100)
          : stampedPct;
        pricedItemPercentSum += displayPct;
        pricedItemPercentCount++;
      }
    }
    if (anyHasPrices) {
      totalVarianceDollars = sumVariance;
      totalStockValueAgg = sumStockValue;
    }
  } catch (e: any) {
    console.error('hostiHealth:stockAccuracy', e);
  }

  let stockAccuracy: number | null = null;
  if (totalStockValueAgg != null && totalStockValueAgg !== 0 && totalVarianceDollars != null) {
    const variancePct = totalVarianceDollars / totalStockValueAgg * 100;
    stockAccuracy = Math.min(95, Math.max(0, 100 - variancePct * 10));
  }

  // ── Pareto Analysis ───────────────────────────────────────────────────────
  let paretoItems: HostiHealthStage3['paretoItems'] = [];
  let paretoTotalVariance = 0;
  let paretoCoverageByTop3 = 0;
  try {
    const allVarianceItems: Array<{
      name: string; areaName: string | null; categoryName: string | null;
      varianceDollars: number; varianceQty: number;
    }> = [];

    let diagWithSnapshot = 0;
    let diagItemsSeen = 0;
    let diagSkippedNull = 0;
    let diagSkippedZero = 0;
    let diagQualified = 0;

    for (const deptDoc of deptsSnap.docs) {
      const latestSnap = (await getDocs(query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('cycleNumber', 'desc'),
        limit(1),
      ))).docs[0];
      if (!latestSnap) continue;
      diagWithSnapshot++;
      const snapData = latestSnap.data() as any;
      const items: any[] = snapData.items || [];
      diagItemsSeen += items.length;
      for (const item of items) {
        const displayVarianceDollars = item.displayTotalVarianceDollars ?? item.totalVarianceDollars;
        if (displayVarianceDollars == null) { diagSkippedNull++; continue; }
        if (displayVarianceDollars === 0)   { diagSkippedZero++; continue; }
        diagQualified++;
        allVarianceItems.push({
          name: item.name || 'Unknown product',
          areaName: item.areaName || null,
          categoryName: item.categoryName || null,
          varianceDollars: displayVarianceDollars,
          varianceQty: item.totalVarianceQty ?? 0,
        });
      }
    }

    console.info(
      `[hostiHealth] paretoItems: depts=${deptsSnap.docs.length}, withSnapshot=${diagWithSnapshot},` +
      ` itemsSeen=${diagItemsSeen}, skippedNull=${diagSkippedNull}, skippedZero=${diagSkippedZero},` +
      ` qualified=${diagQualified}`,
    );

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
  } catch (e: any) {
    console.error('[hostiHealth] paretoItems query failed:', e?.code, e?.message, e);
    console.error('hostiHealth:paretoItems', e);
  }

  // ── Labour Efficiency ─────────────────────────────────────────────────────
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
      : 10;

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
  } catch (e: any) {
    console.error('hostiHealth:labourEfficiency', e);
  }

  // ── Inventory Health — Days of Cover ──────────────────────────────────────
  let inventoryHealth: number | null = null;
  let daysOfCover: number | null = null;
  let operationalStockValue: number | null = null;
  let cellarStockValue: number | null = null;
  let inventoryHealthUsedInvoiceData = false;

  try {
    const { classifyVenueProducts, separateStockLayers } = await import('./classifyProducts');
    const classifications = await classifyVenueProducts(venueId);
    const layers = separateStockLayers(classifications);
    operationalStockValue = layers.operationalStockValue;
    cellarStockValue = layers.cellarStockValue + layers.premiumStockValue;

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

      const deptCycleStart = typeof snapData.cycleStart?.toDate === 'function' ? snapData.cycleStart.toDate() : null;
      const deptCycleEnd = typeof snapData.cycleEnd?.toDate === 'function' ? snapData.cycleEnd.toDate() : null;
      if (deptCycleStart && (earliestCycleStart == null || deptCycleStart < earliestCycleStart)) earliestCycleStart = deptCycleStart;
      if (deptCycleEnd && (latestCycleEnd == null || deptCycleEnd > latestCycleEnd)) latestCycleEnd = deptCycleEnd;

      const cycleNum = snapData.cycleNumber;
      if (cycleNum > 1) {
        const prevSnap = await getDoc(
          doc(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots', `cycle-${cycleNum - 1}`),
        );
        if (prevSnap.exists()) {
          const prev = prevSnap.data() as any;
          prevCycleStockValue = (prevCycleStockValue ?? 0) + ((prev.summary?.displayTotalStockValue ?? prev.summary?.totalStockValue) ?? 0);
        }
      }
    }

    if (deptCount === 0 || operationalStockValue === 0) {
      // Not enough data — stay null
    } else {
      avgCycleDays = totalCycledays / deptCount;

      const openingValue = prevCycleStockValue ?? operationalStockValue;
      const closingValue = operationalStockValue;

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
      } catch (e: any) {
        console.error('hostiHealth:inventoryHealth:invoiceLookup', e);
      }

      if (!inventoryHealthUsedInvoiceData) {
        purchasesValue = Math.max(0, closingValue - openingValue);
      }

      const totalConsumed = openingValue - closingValue + purchasesValue;
      const dailyConsumption = avgCycleDays > 0 ? totalConsumed / avgCycleDays : 0;

      if (dailyConsumption > 0) {
        daysOfCover = Math.round(closingValue / dailyConsumption);

        const targetMin = Math.round(targetDaysOfCover * 0.6);
        const targetMax = Math.round(targetDaysOfCover * 1.4);

        inventoryHealth =
          daysOfCover < Math.round(targetMin * 0.6) ? 20 :
          daysOfCover < targetMin ? 45 + Math.round((daysOfCover / targetMin) * 20) :
          daysOfCover <= targetMax ? Math.min(95, 70 + Math.round((1 - Math.abs(daysOfCover - targetDaysOfCover) / (targetMax - targetMin)) * 25)) :
          daysOfCover <= Math.round(targetMax * 1.5) ? 65 :
          daysOfCover <= Math.round(targetMax * 2) ? 45 :
          20;
      }
    }
  } catch (e: any) {
    console.error('hostiHealth:inventoryHealth', e);
  }

  // ── Ordering Intelligence ─────────────────────────────────────────────────
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
            complianceRates.push(1.0);
            continue;
          }

          const linesSnap = await getDocs(
            collection(db, 'venues', venueId, 'orders', orderDoc.id, 'lines'),
          );
          const lines = linesSnap.docs.map(d => d.data() as { productId: string; qty: number });

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
          orderingIntelligence = Math.round(avgRate * 90);
        }
      }
    } catch (e: any) {
      console.error('hostiHealth:orderingIntelligence', e);
    }
  }

  // ── Confidence-aware Ordering Intelligence weight ─────────────────────────
  let orderingIntelligenceWeight = 0.15;
  if (totalStocktakesCompleted < 3) {
    orderingIntelligenceWeight = 0.05;
  } else if (totalStocktakesCompleted < 6) {
    orderingIntelligenceWeight = 0.10;
  }
  const orderingWeightReduction = 0.15 - orderingIntelligenceWeight;

  // ── Waste Control / Stock Integrity ──────────────────────────────────────
  let wasteControl: number | null = null;
  let wasteControlMode: 'stock_integrity' | 'waste_control' | null = null;
  let wasteControlLabel: string | null = null;

  try {
    const posConfigSnap = await getDoc(doc(db, 'venues', venueId, 'posIntegration', 'config'));
    const posConnected = posConfigSnap.exists() && posConfigSnap.data()?.status === 'connected';

    let hasSalesData = false;
    if (posConnected && totalStocktakesCompleted > 0) {
      const salesSnap = await getDocs(query(collection(db, 'venues', venueId, 'salesReports'), limit(1)));
      hasSalesData = !salesSnap.empty;
    }

    if (posConnected && hasSalesData) {
      const salesReportsSnap = await getDocs(collection(db, 'venues', venueId, 'salesReports'));

      const salesByName: Record<string, number> = {};
      salesReportsSnap.docs.forEach(d => {
        const data = d.data() as any;
        const lines = data.lines || data.report?.lines || [];
        lines.forEach((line: any) => {
          const name = (line.name || '').toLowerCase().trim();
          const qty = Number(line.qtySold || 0);
          if (name && qty > 0) salesByName[name] = (salesByName[name] || 0) + qty;
        });
      });

      let totalWasteDollars = 0;
      let totalStockVal = 0;

      for (const deptDoc of deptsSnap.docs) {
        const latestSnapDocs = await getDocs(
          query(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
            orderBy('cycleNumber', 'desc'),
            limit(1)
          )
        );
        if (latestSnapDocs.empty) continue;
        const snapData = latestSnapDocs.docs[0].data() as any;

        (snapData.items || []).forEach((item: any) => {
          const name = (item.name || '').toLowerCase().trim();
          const varianceUnits = item.totalVarianceQty ?? item.varianceQty ?? 0;
          const costPrice = (item.displayCostPrice ?? item.costPrice) ?? 0;
          const soldUnits = salesByName[name] || 0;
          const stockVal = Math.abs(varianceUnits) * costPrice;
          totalStockVal += stockVal;

          if (varianceUnits < 0) {
            const consumed = Math.abs(varianceUnits);
            const actualWaste = Math.max(0, consumed - soldUnits);
            totalWasteDollars += actualWaste * costPrice;
          }
        });
      }

      if (totalStockVal > 0) {
        const wasteRate = totalWasteDollars / totalStockVal;
        wasteControl = Math.max(0, Math.round(100 - (wasteRate * 500)));
        wasteControlMode = 'waste_control';
        wasteControlLabel = 'Waste Control — calculated from POS sales data';
      }

    } else {
      if (totalStocktakesCompleted >= 3) {
        const productCycleMap: Record<string, { negative: number; total: number; dollarImpact: number }> = {};

        for (const deptDoc of deptsSnap.docs) {
          const recentSnaps = await getDocs(
            query(
              collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
              orderBy('cycleNumber', 'desc'),
              limit(3)
            )
          );

          recentSnaps.docs.forEach(snapDoc => {
            const snapData = snapDoc.data() as any;
            (snapData.items || []).forEach((item: any) => {
              const key = (item.name || item.productId || '').toLowerCase().trim();
              if (!key) return;
              const varianceUnits = item.totalVarianceQty ?? item.varianceQty ?? 0;
              const costPrice = (item.displayCostPrice ?? item.costPrice) ?? 0;
              if (!productCycleMap[key]) productCycleMap[key] = { negative: 0, total: 0, dollarImpact: 0 };
              productCycleMap[key].total++;
              if (varianceUnits < 0) {
                productCycleMap[key].negative++;
                productCycleMap[key].dollarImpact += Math.abs(varianceUnits) * costPrice;
              }
            });
          });
        }

        let systematicLossDollars = 0;
        let totalVarianceDollarsWC = 0;
        Object.values(productCycleMap).forEach(p => {
          totalVarianceDollarsWC += p.dollarImpact;
          if (p.total >= 2 && p.negative / p.total >= 0.67) {
            systematicLossDollars += p.dollarImpact;
          }
        });

        if (totalVarianceDollarsWC > 0) {
          const systematicRate = systematicLossDollars / Math.max(totalVarianceDollarsWC, 1);
          wasteControl = Math.max(0, Math.round(100 - (systematicRate * 100)));
          wasteControlMode = 'stock_integrity';
          wasteControlLabel = 'Stock Integrity — connect your POS for full waste calculation';
        } else if (totalStocktakesCompleted >= 3) {
          wasteControl = 100;
          wasteControlMode = 'stock_integrity';
          wasteControlLabel = 'Stock Integrity — no systematic loss detected';
        }
      }
    }
  } catch (e: any) {
    console.error('hostiHealth:wasteControl', e);
  }

  const kpis = { stockAccuracy, labourEfficiency, inventoryHealth, orderingIntelligence, wasteControl };

  // ── Weighted score ────────────────────────────────────────────────────────
  const weights: Record<string, number> = {
    stockAccuracy: 0.30 + orderingWeightReduction,
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

  // ── Trend ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
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
  } catch (e: any) {
    console.error('hostiHealth:trend', e);
  }

  // ── Previous cycle variance ───────────────────────────────────────────────
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
      const prevVariance = prevCycleData?.summary?.displayTotalVarianceDollars ?? prevCycleData?.summary?.totalVarianceDollars;
      if (typeof prevVariance === 'number') {
        prevCycleVarianceSum += Math.abs(prevVariance);
        prevCycleFound = true;
      }
    }

    if (prevCycleFound) prevVarianceDollars = prevCycleVarianceSum;
  } catch (e: any) {
    console.error('hostiHealth:prevVarianceDollars', e);
  }

  const estimatedImpact = prevVarianceDollars != null && totalVarianceDollars != null
    ? Math.max(0, Math.abs(prevVarianceDollars) - Math.abs(totalVarianceDollars))
    : null;

  // ── Confidence ────────────────────────────────────────────────────────────
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

  // ── Constraint Analysis ───────────────────────────────────────────────────
  let constraint: HostiHealthStage3['constraint'] = null;
  let counterfactual: HostiHealthStage3['counterfactual'] = null;

  try {
    if (avgCycleDays > 21) {
      const impact: 'high' | 'medium' | 'low' = avgCycleDays > 45 ? 'high' : avgCycleDays > 28 ? 'medium' : 'low';
      const recommendedCycleFrequency = targetDaysOfCover <= 7 ? 7 : targetDaysOfCover <= 14 ? 14 : 21;
      constraint = {
        type: 'frequency',
        description: `Your stocktakes are happening every ${Math.round(avgCycleDays)} days. Based on your ${targetDaysOfCover}-day stock target, counting every ${recommendedCycleFrequency} days would give you better visibility.`,
        impact,
        fixAction: `Increase stocktake frequency to every ${recommendedCycleFrequency} days to match your stock holding target.`,
      };

      if (avgCycleDays > recommendedCycleFrequency) {
        let estimatedAdditionalRecovery: number | null = null;
        if (totalVarianceDollars != null) {
          const lagFactor = recommendedCycleFrequency / avgCycleDays;
          estimatedAdditionalRecovery = Math.round(Math.abs(totalVarianceDollars) * (1 - lagFactor));
        }
        counterfactual = {
          scenario: `If you'd counted every ${recommendedCycleFrequency} days instead of every ${Math.round(avgCycleDays)} days`,
          estimatedAdditionalRecovery,
          confidenceLabel: `Based on your last ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''}`,
        };
      }
    }

    if (constraint === null && pricedItemFraction < 0.5) {
      constraint = {
        type: 'cost_completeness',
        description: `Less than half your products have cost prices — your financial impact calculations are estimates only.`,
        impact: 'medium',
        fixAction: 'Add cost prices to your products to unlock accurate stock value, variance dollar amounts, and ROI calculations.',
      };
    }

    if (constraint === null && deptsSnap.docs.length === 1) {
      constraint = {
        type: 'single_department',
        description: 'You have one department. Adding separate departments (e.g. Bar, Kitchen, Cellar) gives you area-specific variance tracking.',
        impact: 'low',
        fixAction: 'Add departments in Settings to track variance by area and identify where leakage is occurring.',
      };
    }
  } catch (e: any) {
    console.error('hostiHealth:constraintAnalysis', e);
  }

  const stockValueResolved = totalStockValueAgg;

  // ── Abductive Insights ────────────────────────────────────────────────────
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
    console.error('hostiHealth:abductiveInsights', e);
    abductiveInsights = [];
  }

  // ── Stockout Predictions ──────────────────────────────────────────────────
  let predictions: HostiHealthStage3['predictions'] = null;
  try {
    if (totalStocktakesCompleted >= 2) {
      predictions = await generateStockoutPredictions(venueId, avgCycleDays);
    }
  } catch (e: any) {
    console.error('hostiHealth:predictions', e);
  }

  // ── Monthly snapshot write ────────────────────────────────────────────────
  try {
    await setDoc(doc(db, 'venues', venueId, 'profitRecoverySnapshots', monthKey), {
      score,
      confidence: confidenceLabel,
      kpiScores: kpis,
      estimatedImpact,
      stockValue: stockValueResolved,
      varianceDollars: totalVarianceDollars,
      calculatedAt: Date.now(),
      paretoTop10: paretoItems.slice(0, 10).map(p => ({
        name: p.name,
        varianceDollars: p.varianceDollars,
        contributionPct: p.contributionPct,
        areaName: p.areaName || null,
        categoryName: p.categoryName || null,
      })),
      paretoTop3: paretoItems.slice(0, 3).map(p => ({
        name: p.name,
        varianceDollars: p.varianceDollars,
        contributionPct: p.contributionPct,
        areaName: p.areaName || null,
        categoryName: p.categoryName || null,
      })),
      paretoTotalVariance: paretoTotalVariance ?? null,
      topInsight: abductiveInsights[0] ? {
        pattern: abductiveInsights[0].pattern,
        mostLikelyExplanation: abductiveInsights[0].mostLikelyExplanation,
        confidence: abductiveInsights[0].confidence,
        confidenceLabel: abductiveInsights[0].confidenceLabel,
        actionable: abductiveInsights[0].actionable,
        severity: abductiveInsights[0].severity,
      } : null,
      constraintType: constraint?.type ?? null,
      constraintDescription: constraint?.description ?? null,
      constraintFixAction: constraint?.fixAction ?? null,
      constraintImpact: constraint?.impact ?? null,
      daysOfCover: daysOfCover ?? null,
      targetDaysOfCover: targetDaysOfCover ?? null,
      operationalStockValue: operationalStockValue ?? null,
      cellarStockValue: cellarStockValue ?? null,
    }, { merge: true });
  } catch (e: any) {
    console.error('hostiHealth:monthlySnapshotWrite', e);
  }

  return {
    stage: 3,
    score,
    label,
    confidence: confidenceLabel,
    trend,
    trendDirection,
    estimatedImpact,
    kpis: {
      stockAccuracy,
      labourEfficiency,
      inventoryHealth,
      orderingIntelligence,
      wasteControl,
      wasteControlMode,
      wasteControlLabel,
    },
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
