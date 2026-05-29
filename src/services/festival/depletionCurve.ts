// @ts-nocheck

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface DepletionPoint {
  time: Date;
  stock: number;
  isActual: boolean;
}

export interface DepletionCurve {
  points: DepletionPoint[];
  selloutTime: Date | null;
  targetRemainingReachedAt: Date | null;
  recommendation: string;
  recommendationType: 'on_track' | 'sellout_before_close' | 'too_much_stock' | 'surplus_risk' | 'no_data';
}

// ─── Session type to hours ────────────────────────────────────────────────────

const SESSION_DURATION: Record<string, number> = {
  morning: 4, afternoon: 4, evening: 5, full_day: 12,
};

// ─── Main function ────────────────────────────────────────────────────────────

export function buildDepletionCurve(
  sessions: any[],
  productId: string,
  currentStock: number,
  velocity: number,
  eventCloseTime: Date,
  targetRemaining: number = 0,
  returnAllowancePercent?: number,
): DepletionCurve {
  const now = new Date();
  const points: DepletionPoint[] = [];

  // Build historical points from actual session counts
  const productSessions = sessions
    .filter(s => Array.isArray(s.counts) && s.counts.some((c: any) => c.productId === productId))
    .sort((a, b) => {
      const ta = a.completedAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.completedAt?.toDate?.()?.getTime() ?? 0;
      return ta - tb;
    });

  for (const sess of productSessions) {
    const countRow = sess.counts?.find((c: any) => c.productId === productId);
    if (!countRow) continue;
    const t = sess.completedAt?.toDate?.();
    if (!t) continue;
    points.push({
      time: t,
      stock: countRow.actualCount ?? 0,
      isActual: true,
    });
  }

  // Add current stock as the most recent actual point
  points.push({ time: now, stock: currentStock, isActual: true });

  // Project forward every 30 minutes until event close or stock hits 0
  if (velocity > 0) {
    let projectedStock = currentStock;
    let projectedTime = new Date(now.getTime());
    const stepMs = 30 * 60 * 1000;

    while (projectedTime <= eventCloseTime && projectedStock > 0) {
      projectedTime = new Date(projectedTime.getTime() + stepMs);
      projectedStock = Math.max(0, projectedStock - velocity * 0.5);
      points.push({ time: new Date(projectedTime), stock: projectedStock, isActual: false });
      if (projectedStock === 0) break;
    }
  }

  // Find sellout time (first projected point where stock = 0)
  const selloutPoint = points.find(p => !p.isActual && p.stock === 0);
  const selloutTime = selloutPoint?.time ?? null;

  // Find when stock reaches targetRemaining
  const targetPoint = points.find(p => !p.isActual && p.stock <= targetRemaining && p.stock >= 0);
  const targetRemainingReachedAt = targetPoint?.time ?? null;

  // Recommendation
  const hoursToClose = (eventCloseTime.getTime() - now.getTime()) / 3_600_000;
  const hoursToSellout = selloutTime
    ? (selloutTime.getTime() - now.getTime()) / 3_600_000
    : null;

  let recommendation: string;
  let recommendationType: DepletionCurve['recommendationType'];

  if (velocity === 0) {
    recommendation = 'No velocity data — unable to project depletion.';
    recommendationType = 'no_data';
  } else if (hoursToSellout !== null && hoursToSellout < hoursToClose - 0.5) {
    const minsToSellout = Math.round(hoursToSellout * 60);
    recommendation = `At current velocity, stock will run out ~${minsToSellout < 60
      ? `${minsToSellout}min`
      : `${Math.round(hoursToSellout * 10) / 10}hr`} before close. Consider requesting a top-up.`;
    recommendationType = 'sellout_before_close';
  } else if (hoursToSellout === null && currentStock > velocity * hoursToClose * 1.3) {
    recommendation = 'More stock than needed to close. Consider transferring surplus to another bar.';
    recommendationType = 'too_much_stock';
  } else {
    recommendation = 'On track to close with target remaining stock.';
    recommendationType = 'on_track';
  }

  // Surplus risk: projected remaining at close exceeds the return allowance
  if (returnAllowancePercent != null && returnAllowancePercent > 0 && velocity > 0) {
    const openingStock = points.find(p => p.isActual)?.stock ?? currentStock;
    const projectedAtClose = Math.max(0, currentStock - velocity * hoursToClose);
    const maxReturnable = openingStock * returnAllowancePercent / 100;
    if (projectedAtClose > maxReturnable && recommendationType !== 'sellout_before_close') {
      recommendation = `Projected remaining at close (${Math.round(projectedAtClose)} units) exceeds your ${returnAllowancePercent}% return allowance (${Math.round(maxReturnable)} units). Consider accelerating sales or redistributing stock.`;
      recommendationType = 'surplus_risk';
    }
  }

  return {
    points,
    selloutTime,
    targetRemainingReachedAt,
    recommendation,
    recommendationType,
  };
}
