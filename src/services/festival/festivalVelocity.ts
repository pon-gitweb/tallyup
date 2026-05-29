import { collection, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../firebase';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type VelocityConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type VelocityStatus = 'healthy' | 'low' | 'critical' | 'unknown';

export interface FestivalVelocityData {
  unitsPerHour: number;
  hoursRemaining: number | null;
  confidence: VelocityConfidence;
  status: VelocityStatus;
  sessionCount: number;
  basis: 'sessions' | 'distributions' | 'benchmark' | 'none';
  lastUpdated: Date;
}

// ─── Category benchmarks (units per person per day) ──────────────────────────

const BENCHMARKS: Record<string, number> = {
  beer:    2.8,
  wine:    0.6,
  spirits: 0.4,
  rtd:     1.2,
  na:      0.8,
};

function guessCategoryBenchmark(productName: string): number {
  const name = (productName || '').toLowerCase();
  if (name.includes('beer') || name.includes('lager') || name.includes('ale') || name.includes('ipa')) return BENCHMARKS.beer;
  if (name.includes('wine') || name.includes('sauvignon') || name.includes('pinot') || name.includes('rosé') || name.includes('rose')) return BENCHMARKS.wine;
  if (name.includes('spirit') || name.includes('whisky') || name.includes('whiskey') || name.includes('vodka') || name.includes('rum') || name.includes('gin')) return BENCHMARKS.spirits;
  if (name.includes('rtd') || name.includes('ready') || name.includes('seltzer') || name.includes('hard')) return BENCHMARKS.rtd;
  return BENCHMARKS.na;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function calculateFestivalVelocity(
  venueId: string,
  barId: string,
  productId: string,
  currentStock: number,
  hoursRemainingToday: number | null,
  attendanceEstimate?: number,
  productName?: string,
): Promise<FestivalVelocityData> {
  const now = new Date();

  try {
    // PRIORITY 1: Check for actual sales data
    try {
      const salesSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'event', 'details', 'salesData'),
          where('status', '==', 'applied'),
          orderBy('uploadedAt', 'desc'),
          limit(10),
        )
      );
      if (!salesSnap.empty) {
        let totalSold = 0;
        for (const uploadDoc of salesSnap.docs) {
          const data = uploadDoc.data() as any;
          for (const line of (data.lineItems || [])) {
            if (line.productId !== productId) continue;
            if (barId && line.barId && line.barId !== barId) continue;
            totalSold += line.unitsSold || 0;
          }
        }
        if (totalSold > 0) {
          // Estimate hours from earliest to latest upload period
          const timestamps = salesSnap.docs
            .map(d => (d.data() as any).periodStart?.toDate?.())
            .filter(Boolean);
          const earliest = timestamps.length > 0 ? Math.min(...timestamps.map((t: Date) => t.getTime())) : null;
          const hoursElapsed = earliest
            ? Math.max(1, (now.getTime() - earliest) / (1000 * 60 * 60))
            : 12;
          const unitsPerHour = totalSold / hoursElapsed;
          const hoursRemaining = unitsPerHour > 0 && hoursRemainingToday != null
            ? currentStock / unitsPerHour : null;
          return {
            unitsPerHour,
            hoursRemaining,
            confidence: 'HIGH',
            status: hoursRemaining == null ? 'unknown' : hoursRemaining > 4 ? 'healthy' : hoursRemaining > 1 ? 'low' : 'critical',
            sessionCount: 0,
            basis: 'distributions',
            lastUpdated: now,
          };
        }
      }
    } catch {}

    // Collect usage from sessions (last 20 for this bar)
    const sessionsSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'sessions'),
        orderBy('completedAt', 'desc'),
        limit(20),
      ),
    );

    const barSessions = sessionsSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(s => s.barId === barId && Array.isArray(s.counts));

    // Extract product-level usage and duration from each session
    type UsageSample = { usage: number; durationHours: number };
    const samples: UsageSample[] = [];

    for (const sess of barSessions) {
      const countRow = sess.counts?.find((c: any) => c.productId === productId);
      if (!countRow) continue;
      const used = countRow.openingCount + (countRow.receivedQty ?? 0) - countRow.actualCount;
      if (used <= 0) continue;

      // Estimate session duration by type
      const durationMap: Record<string, number> = {
        morning: 4, afternoon: 4, evening: 5, full_day: 12,
      };
      const durationHours = durationMap[sess.sessionType] ?? 4;
      samples.push({ usage: used, durationHours });
    }

    // Collect usage from delivered requests (top-ups fulfilled = stock was consumed fast enough to need more)
    const requestsSnap = await getDocs(
      collection(db, 'venues', venueId, 'requests'),
    );
    const deliveredForBar = requestsSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(r => r.barId === barId && r.status === 'delivered' && Array.isArray(r.products));

    // Each delivered request: usage credit = 2hr of velocity if items matched product
    for (const req of deliveredForBar) {
      const prodEntry = req.products?.find((p: any) => p.productId === productId);
      if (!prodEntry) continue;
      samples.push({ usage: prodEntry.quantity ?? 0, durationHours: 2 });
    }

    if (samples.length === 0) {
      // No session data — fall back to benchmark
      const benchmark = guessCategoryBenchmark(productName ?? productId);
      const attendanceHourly = attendanceEstimate ? attendanceEstimate / 10 : 200;
      const estimatedUPH = (benchmark * attendanceHourly) / 1000;
      const hoursRemaining = estimatedUPH > 0 ? currentStock / estimatedUPH : null;

      return {
        unitsPerHour: estimatedUPH,
        hoursRemaining,
        confidence: 'NONE',
        status: hoursRemaining == null ? 'unknown' : hoursRemaining > 4 ? 'healthy' : hoursRemaining > 1 ? 'low' : 'critical',
        sessionCount: 0,
        basis: 'benchmark',
        lastUpdated: now,
      };
    }

    // Weighted average velocity (unitsPerHour)
    const totalUsage = samples.reduce((sum, s) => sum + s.usage, 0);
    const totalHours = samples.reduce((sum, s) => sum + s.durationHours, 0);
    const unitsPerHour = totalHours > 0 ? totalUsage / totalHours : 0;

    const sessionCount = barSessions.filter(s =>
      s.counts?.some((c: any) => c.productId === productId && (c.openingCount - c.actualCount) > 0)
    ).length;

    const confidence: VelocityConfidence =
      sessionCount >= 3 ? 'HIGH' :
      sessionCount >= 1 ? 'MEDIUM' :
      deliveredForBar.length > 0 ? 'LOW' : 'NONE';

    const hoursRemaining = unitsPerHour > 0 && hoursRemainingToday != null
      ? currentStock / unitsPerHour
      : null;

    const status: VelocityStatus =
      hoursRemaining == null ? 'unknown' :
      hoursRemaining > 4 ? 'healthy' :
      hoursRemaining > 1 ? 'low' :
      'critical';

    return {
      unitsPerHour,
      hoursRemaining,
      confidence,
      status,
      sessionCount,
      basis: sessionCount > 0 ? 'sessions' : 'distributions',
      lastUpdated: now,
    };
  } catch {
    return {
      unitsPerHour: 0,
      hoursRemaining: null,
      confidence: 'NONE',
      status: 'unknown',
      sessionCount: 0,
      basis: 'none',
      lastUpdated: now,
    };
  }
}
