/**
 * Hourly intelligence for festival bars.
 *
 * Groups session counts into hourly windows and computes:
 * - Velocity per hour per product
 * - Busiest hour per bar
 * - Hourly heatmap data (units consumed per hour)
 * - Peak velocity detection
 *
 * Performance correlation (e.g. which stage/act was playing) is
 * designed to be added later — the hourly windows are the anchor.
 */

export interface HourlyBucket {
  hour: number;           // 0-23 — hour of day
  label: string;          // e.g. "8pm", "9pm"
  windowStart: Date;
  windowEnd: Date;
  totalConsumed: number;  // units consumed across all products in this hour
  byProduct: Record<string, number>; // productId → units consumed
  sessionCount: number;   // how many sessions fell in this window
  note?: string;          // future: "DJ Sola", "Main act", etc.
}

export interface HourlyIntelligence {
  buckets: HourlyBucket[];
  peakHour: HourlyBucket | null;
  quietestHour: HourlyBucket | null;
  peakProduct: { productId: string; productName: string; consumed: number } | null;
  totalConsumed: number;
  averageHourlyVelocity: number;
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export function buildHourlyIntelligence(
  sessions: any[],
  eventStartDate?: string, // DD/MM/YYYY
): HourlyIntelligence {
  if (!sessions || sessions.length < 2) {
    return {
      buckets: [], peakHour: null, quietestHour: null,
      peakProduct: null, totalConsumed: 0, averageHourlyVelocity: 0,
    };
  }

  // Sort sessions by completedAt ascending
  const sorted = [...sessions].filter(s => s.completedAt?.toMillis?.()).sort(
    (a, b) => (a.completedAt.toMillis()) - (b.completedAt.toMillis())
  );

  if (sorted.length < 2) {
    return {
      buckets: [], peakHour: null, quietestHour: null,
      peakProduct: null, totalConsumed: 0, averageHourlyVelocity: 0,
    };
  }

  // Build hourly consumption windows from session-to-session differences.
  // Each pair of consecutive sessions defines a window of consumption.
  const hourlyTotals: Record<number, {
    consumed: number;
    byProduct: Record<string, number>;
    sessionCount: number;
    windowStart: Date;
    windowEnd: Date;
  }> = {};

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const currTime = new Date(curr.completedAt.toMillis());
    const windowHour = currTime.getHours(); // attribute consumption to the hour when it was measured

    if (!hourlyTotals[windowHour]) {
      hourlyTotals[windowHour] = {
        consumed: 0, byProduct: {}, sessionCount: 0,
        windowStart: currTime, windowEnd: currTime,
      };
    }

    hourlyTotals[windowHour].sessionCount++;
    if (currTime > hourlyTotals[windowHour].windowEnd) hourlyTotals[windowHour].windowEnd = currTime;
    if (currTime < hourlyTotals[windowHour].windowStart) hourlyTotals[windowHour].windowStart = currTime;

    // Calculate consumption per product between prev and curr session
    const currCounts = curr.counts || [];
    const prevCounts = prev.counts || [];
    for (const currItem of currCounts) {
      const prevItem = prevCounts.find((p: any) => p.productId === currItem.productId);
      if (!prevItem) continue;
      const received = currItem.receivedQty ?? 0;
      const consumed = Math.max(0, (prevItem.actualCount + received) - currItem.actualCount);
      hourlyTotals[windowHour].consumed += consumed;
      hourlyTotals[windowHour].byProduct[currItem.productId] =
        (hourlyTotals[windowHour].byProduct[currItem.productId] || 0) + consumed;
    }
  }

  // Build sorted bucket array
  const buckets: HourlyBucket[] = Object.entries(hourlyTotals)
    .map(([h, data]) => ({
      hour: Number(h),
      label: hourLabel(Number(h)),
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
      totalConsumed: data.consumed,
      byProduct: data.byProduct,
      sessionCount: data.sessionCount,
    }))
    .sort((a, b) => a.hour - b.hour);

  if (buckets.length === 0) {
    return { buckets: [], peakHour: null, quietestHour: null, peakProduct: null, totalConsumed: 0, averageHourlyVelocity: 0 };
  }

  const peakHour = [...buckets].sort((a, b) => b.totalConsumed - a.totalConsumed)[0] || null;
  const quietestHour = [...buckets].filter(b => b.totalConsumed > 0).sort((a, b) => a.totalConsumed - b.totalConsumed)[0] || null;
  const totalConsumed = buckets.reduce((s, b) => s + b.totalConsumed, 0);
  const averageHourlyVelocity = buckets.length > 0 ? totalConsumed / buckets.length : 0;

  // Find peak product across all hours
  const productTotals: Record<string, { consumed: number; productName: string }> = {};
  for (const sess of sorted) {
    for (const item of (sess.counts || [])) {
      if (!productTotals[item.productId]) {
        productTotals[item.productId] = { consumed: 0, productName: item.productName || item.productId };
      }
    }
  }
  for (const bucket of buckets) {
    for (const [pid, consumed] of Object.entries(bucket.byProduct)) {
      if (productTotals[pid]) productTotals[pid].consumed += consumed as number;
    }
  }
  const peakProductEntry = Object.entries(productTotals).sort((a, b) => b[1].consumed - a[1].consumed)[0];
  const peakProduct = peakProductEntry
    ? { productId: peakProductEntry[0], ...peakProductEntry[1] }
    : null;

  return { buckets, peakHour, quietestHour, peakProduct, totalConsumed, averageHourlyVelocity };
}
