// @ts-nocheck
/**
 * Predictive Modelling — pure arithmetic stockout predictions. No AI.
 * Derives a simple 2-cycle velocity directly from snapshot items (deliberately
 * simpler than velocityService.ts's multi-cycle calculateVelocity — this only
 * needs a near-term run-rate, not trend/confidence/expiry analysis).
 */
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

export interface StockoutPrediction {
  productId: string;
  name: string;
  currentStock: number;         // lastCount
  velocityPerDay: number;       // unitsPerWeek / 7
  daysUntilStockout: number;    // currentStock / velocityPerDay, rounded
  stockoutDate: string;         // ISO date string
  urgency: 'critical' | 'warning' | 'watch'; // < 3 days, 3–7 days, 7–14 days
  parLevel: number | null;
  daysUntilBelowPAR: number | null; // when stock drops below PAR at current velocity
  confidenceLabel: 'High' | 'Medium' | 'Low';
  areaName: string | null;
  categoryName: string | null;
}

export interface PredictionSummary {
  stockoutPredictions: StockoutPrediction[]; // sorted by urgency, then daysUntilStockout
  criticalCount: number;   // < 3 days
  warningCount: number;    // 3–7 days
  watchCount: number;      // 7–14 days
  generatedAt: number;     // Date.now()
}

export async function generateStockoutPredictions(
  venueId: string,
  avgCycleDays: number,
): Promise<PredictionSummary> {
  const predictions: StockoutPrediction[] = [];

  // Read products with both lastCount and velocity data
  // Velocity comes from snapshot items — same source as suggest.ts
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  for (const deptDoc of deptsSnap.docs) {
    // Get latest snapshot for velocity data
    const latestSnaps = await getDocs(
      query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('cycleNumber', 'desc'),
        limit(2)  // need 2 for velocity calculation
      )
    );
    if (latestSnaps.docs.length < 2) continue; // need at least 2 cycles for velocity

    const latest = latestSnaps.docs[0].data() as any;
    const previous = latestSnaps.docs[1].data() as any;

    const latestItems = (latest.items || []) as any[];
    const prevItemMap = new Map<string, number>();
    for (const item of (previous.items || [])) {
      const key = (item.name || '').toLowerCase().trim();
      prevItemMap.set(key, item.actualClosing ?? 0);
    }

    const cycleDays = latest.daysSinceLastCycle ?? avgCycleDays;
    if (cycleDays <= 0) continue;

    for (const item of latestItems) {
      const name = item.name || 'Unknown';
      const key = name.toLowerCase().trim();
      const currentStock = item.actualClosing ?? 0;
      const prevStock = prevItemMap.get(key);

      if (prevStock == null || currentStock <= 0) continue;
      if (item.costPrice == null) continue; // skip products without prices — unreliable

      // Calculate velocity: units consumed between cycles / days in cycle
      // Consumption = prevStock - currentStock (negative variance = consumed)
      // Also account for deliveries: if currentStock > prevStock, deliveries happened
      // Use abs of variance as proxy for consumption rate
      const consumed = prevStock - currentStock;
      if (consumed <= 0) continue; // not consuming this product — skip

      const velocityPerDay = consumed / cycleDays;
      const daysUntilStockout = Math.floor(currentStock / velocityPerDay);

      if (daysUntilStockout > 14) continue; // only surface near-term predictions

      const stockoutDate = new Date(Date.now() + daysUntilStockout * 86400000)
        .toISOString().slice(0, 10);

      const urgency: 'critical' | 'warning' | 'watch' =
        daysUntilStockout < 3 ? 'critical' :
        daysUntilStockout <= 7 ? 'warning' :
        'watch';

      const parLevel = item.parLevel ?? null;
      const daysUntilBelowPAR = parLevel != null && parLevel > 0 && velocityPerDay > 0
        ? Math.floor((currentStock - parLevel) / velocityPerDay)
        : null;

      // Confidence based on cycle count and velocity consistency
      // More cycles = more reliable velocity estimate
      const cycleCount = latest.cycleNumber ?? 1;
      const confidenceLabel: 'High' | 'Medium' | 'Low' =
        cycleCount >= 4 ? 'High' :
        cycleCount >= 2 ? 'Medium' :
        'Low';

      predictions.push({
        productId: item.productId || name,
        name,
        currentStock,
        velocityPerDay: Math.round(velocityPerDay * 100) / 100,
        daysUntilStockout,
        stockoutDate,
        urgency,
        parLevel,
        daysUntilBelowPAR,
        confidenceLabel,
        areaName: item.areaName || null,
        categoryName: item.categoryName || null,
      });
    }
  }

  // Sort: critical first, then by daysUntilStockout ascending
  const urgencyOrder = { critical: 0, warning: 1, watch: 2 };
  predictions.sort((a, b) =>
    urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
    a.daysUntilStockout - b.daysUntilStockout
  );

  return {
    stockoutPredictions: predictions,
    criticalCount: predictions.filter(p => p.urgency === 'critical').length,
    warningCount: predictions.filter(p => p.urgency === 'warning').length,
    watchCount: predictions.filter(p => p.urgency === 'watch').length,
    generatedAt: Date.now(),
  };
}
