// @ts-nocheck
// Pure math — no AI, no Firestore reads. Calculates velocity and performance
// metrics from snapshot documents (each snapshot has an .items[] array).

export interface VelocityData {
  productId: string;
  productName: string;

  // Velocity
  unitsPerWeek: number;
  unitsPerDay: number;
  trend: 'rising' | 'falling' | 'stable';
  trendPercent: number;
  confidence: 'high' | 'medium' | 'low';
  cyclesAnalysed: number;

  // Performance status
  status: 'fast' | 'healthy' | 'slow' | 'stagnant';
  statusReason: string;

  // Shelf metrics
  daysOnShelf: number | null;
  currentStock: number;
  daysToSellThrough: number | null;

  // PAR analysis
  parLevel: number | null;
  parAdequacy: 'too_high' | 'appropriate' | 'too_low' | null;
  suggestedPAR: number | null;

  // Cost metrics
  costPerWeek: number | null;
  deadStockCostPerMonth: number | null;

  // Expiry risk
  expiryDate: Date | null;
  daysToExpiry: number | null;
  expiryRisk: boolean;
  expiryRiskDays: number | null;

  // Extras for UI
  areaName: string | null;
  categoryName: string | null;
}

function toDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val.toMillis === 'function') return new Date(val.toMillis());
  if (val instanceof Date) return val;
  if (typeof val === 'string') { const d = new Date(val); return isNaN(d.getTime()) ? null : d; }
  return null;
}

/**
 * calculateVelocity
 * @param snapshots Array of snapshot documents (any order). Each must have
 *   .items[], .daysSinceLastCycle, .completedAt, .cycleNumber.
 * @returns Map keyed by lowercased product name → VelocityData
 */
export function calculateVelocity(snapshots: any[]): Map<string, VelocityData> {
  // Sort oldest first so cycle indices are sequential
  const sorted = [...snapshots].sort((a, b) => {
    const aMs = toDate(a.completedAt)?.getTime() ?? (a.cycleNumber ?? 0) * 1e10;
    const bMs = toDate(b.completedAt)?.getTime() ?? (b.cycleNumber ?? 0) * 1e10;
    return aMs - bMs;
  });

  // Per-product cycle data
  type CycleEntry = {
    velocity: number;         // units/week (0 if not calculable)
    openingCount: number | null;
    actualClosing: number;
    receivedQty: number;
    costPrice: number | null;
    parLevel: number | null;
    expiryDate: any;
    daysSinceLastCycle: number | null;
    areaName: string | null;
    categoryName: string | null;
    productId: string;
    productName: string;
  };
  const byName = new Map<string, CycleEntry[]>();

  for (const snap of sorted) {
    const daysSince: number | null =
      typeof snap.daysSinceLastCycle === 'number' ? snap.daysSinceLastCycle : null;
    const cycleWeeks = daysSince != null && daysSince > 0 ? daysSince / 7 : null;

    for (const item of snap.items || []) {
      const key = (item.name || '').toLowerCase().trim();
      if (!key) continue;

      const openingCount =
        typeof item.openingCount === 'number' ? item.openingCount : null;
      const actualClosing =
        typeof item.actualClosing === 'number' ? item.actualClosing : 0;
      const receivedQty =
        typeof item.receivedQty === 'number' ? item.receivedQty : 0;

      let velocity = 0;
      if (openingCount != null && cycleWeeks != null && cycleWeeks > 0) {
        const usage = openingCount + receivedQty - actualClosing;
        velocity = usage / cycleWeeks;
      } else if (openingCount == null && cycleWeeks != null && cycleWeeks > 0) {
        // First cycle for this product — no prior baseline.
        // If deliveries were received and stock > 0, use closing as conservative usage estimate.
        if (receivedQty > 0 && actualClosing >= 0) {
          velocity = Math.max(0, receivedQty - actualClosing) / cycleWeeks;
        }
      }

      const entry: CycleEntry = {
        velocity,
        openingCount,
        actualClosing,
        receivedQty,
        costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
        parLevel: typeof item.parLevel === 'number' ? item.parLevel : null,
        expiryDate: item.expiryDate ?? null,
        daysSinceLastCycle: daysSince,
        areaName: item.areaName ?? null,
        categoryName: item.categoryName ?? null,
        productId: item.productId || key,
        productName: item.name || key,
      };

      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(entry);
    }
  }

  const today = new Date();
  const result = new Map<string, VelocityData>();

  byName.forEach((entries, key) => {
    const last = entries[entries.length - 1];
    const cyclesAnalysed = entries.length;
    const validEntries = entries.filter(e => e.openingCount != null && e.daysSinceLastCycle != null && e.daysSinceLastCycle > 0);

    // Average velocity
    const avgVelocity = validEntries.length > 0
      ? validEntries.reduce((s, e) => s + e.velocity, 0) / validEntries.length
      : 0;

    // Trend: compare last 2 cycles vs previous 2 cycles
    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    let trendPercent = 0;
    if (validEntries.length >= 4) {
      const recent = validEntries.slice(-2);
      const older = validEntries.slice(-4, -2);
      const recentAvg = recent.reduce((s, e) => s + e.velocity, 0) / 2;
      const olderAvg = older.reduce((s, e) => s + e.velocity, 0) / 2;
      if (olderAvg > 0) {
        trendPercent = ((recentAvg - olderAvg) / olderAvg) * 100;
        if (trendPercent > 10) trend = 'rising';
        else if (trendPercent < -10) trend = 'falling';
      }
    }

    // Confidence
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (cyclesAnalysed >= 6) confidence = 'high';
    else if (cyclesAnalysed >= 3) confidence = 'medium';

    // Performance status
    let status: 'fast' | 'healthy' | 'slow' | 'stagnant' = 'stagnant';
    let statusReason = 'No movement detected';
    if (avgVelocity > 2) { status = 'fast'; statusReason = 'High turnover'; }
    else if (avgVelocity >= 0.5) { status = 'healthy'; statusReason = 'Moving steadily'; }
    else if (avgVelocity >= 0.1) { status = 'slow'; statusReason = 'Moving slowly'; }

    const currentStock = last.actualClosing;

    const daysToSellThrough = avgVelocity > 0
      ? Math.round((currentStock / avgVelocity) * 7)
      : null;

    // PAR adequacy
    const parLevel = last.parLevel;
    let parAdequacy: 'too_high' | 'appropriate' | 'too_low' | null = null;
    let suggestedPAR: number | null = null;
    if (parLevel != null && avgVelocity > 0) {
      const weeklyParUsage = parLevel / avgVelocity;
      if (weeklyParUsage > 3) parAdequacy = 'too_high';
      else if (weeklyParUsage < 0.5) parAdequacy = 'too_low';
      else parAdequacy = 'appropriate';
      suggestedPAR = Math.ceil(avgVelocity * 1.5);
    }

    // Cost metrics
    const costPrice = last.costPrice;
    const costPerWeek = costPrice != null && avgVelocity > 0 ? avgVelocity * costPrice : null;
    let deadStockCostPerMonth: number | null = null;
    if (status === 'stagnant' && costPrice != null && currentStock > 0 && avgVelocity >= 0) {
      const monthlyUsage = avgVelocity * 4;
      const deadFraction = currentStock > 0 ? Math.max(0, 1 - monthlyUsage / currentStock) : 1;
      deadStockCostPerMonth = currentStock * costPrice * deadFraction;
    }

    // Expiry risk
    const expiryRaw = last.expiryDate;
    const expiryDate = toDate(expiryRaw);
    let daysToExpiry: number | null = null;
    let expiryRisk = false;
    let expiryRiskDays: number | null = null;
    if (expiryDate) {
      daysToExpiry = Math.round(
        (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysToSellThrough != null) {
        expiryRisk = daysToSellThrough > daysToExpiry;
        expiryRiskDays = daysToSellThrough - daysToExpiry;
      }
    }

    result.set(key, {
      productId: last.productId,
      productName: last.productName,
      unitsPerWeek: Math.max(0, avgVelocity),
      unitsPerDay: Math.max(0, avgVelocity / 7),
      trend,
      trendPercent: Math.round(trendPercent),
      confidence,
      cyclesAnalysed,
      status,
      statusReason,
      daysOnShelf: daysToSellThrough,
      currentStock,
      daysToSellThrough,
      parLevel,
      parAdequacy,
      suggestedPAR,
      costPerWeek,
      deadStockCostPerMonth,
      expiryDate,
      daysToExpiry,
      expiryRisk,
      expiryRiskDays,
      areaName: last.areaName,
      categoryName: last.categoryName,
    });
  });

  return result;
}
