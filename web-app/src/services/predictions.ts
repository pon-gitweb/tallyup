/**
 * Predictive Modelling — pure arithmetic stockout predictions. No AI.
 * Velocity comes from velocityService.ts's multi-cycle calculateVelocity (the
 * same function suggest.ts uses), preferring its EMA-weighted rate so recent
 * cycles matter more than a stale 6-month-old reading.
 */
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { calculateVelocity } from './velocityService';

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
  _avgCycleDays: number,
): Promise<PredictionSummary> {
  const predictions: StockoutPrediction[] = [];

  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  for (const deptDoc of deptsSnap.docs) {
    const allSnapshotsSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        orderBy('cycleNumber', 'asc'),
      ),
    );

    if (allSnapshotsSnap.docs.length < 2) continue;

    const velocityMap = calculateVelocity(
      allSnapshotsSnap.docs.map(d => d.data()),
    );

    const latestSnap = allSnapshotsSnap.docs[allSnapshotsSnap.docs.length - 1].data() as any;

    for (const item of (latestSnap.items || [])) {
      const name = item.name || 'Unknown';
      const key = name.toLowerCase().trim();
      const currentStock = item.actualClosing ?? 0;

      if (currentStock <= 0) continue;
      if (item.costPrice == null) continue;

      const velData = velocityMap.get(key);
      if (!velData || velData.unitsPerDay <= 0) continue;
      if (velData.needsMoreData) continue;

      const velocityPerDay = velData.emaVelocityPerDay > 0
        ? velData.emaVelocityPerDay
        : velData.unitsPerDay;
      const daysUntilStockout = Math.floor(currentStock / velocityPerDay);

      if (daysUntilStockout > 14) continue;

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

      const confidenceLabel: 'High' | 'Medium' | 'Low' =
        velData.confidence === 'high' ? 'High' :
        velData.confidence === 'medium' ? 'Medium' :
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
