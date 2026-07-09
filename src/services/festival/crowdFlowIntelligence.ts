/**
 * Crowd Flow Intelligence
 *
 * Infers crowd movement across festival bars from session velocity data.
 * No GPS needed — consumption velocity is the crowd proxy.
 *
 * High velocity at a bar = crowds are there.
 * Velocity spike then drop = crowd moved on.
 * Correlated spikes across bars = crowd split or migrated.
 *
 * Future hook: assign stage/performance names to hourly windows
 * to explain WHY the crowd moved. For now, the WHEN is captured.
 *
 * Over multiple events this data builds staffing intelligence:
 * "Main Stage Bar always peaks at 9pm — staff up by 8:30pm"
 */

export interface BarHourlyVelocity {
  barId: string;
  barName: string;
  hour: number;
  label: string;
  velocity: number;      // units/hour
  consumed: number;      // total units consumed
  sessionCount: number;
}

export interface CrowdFlowEvent {
  fromBar: string;
  toBar: string;
  atHour: number;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

export interface HourSnapshot {
  hour: number;
  label: string;
  busiestBar: string | null;
  busiestBarVelocity: number;
  quietestBar: string | null;
  barVelocities: Record<string, number>; // barId → velocity
}

export interface CrowdFlowIntelligence {
  hourSnapshots: HourSnapshot[];
  flowEvents: CrowdFlowEvent[];
  peakHour: HourSnapshot | null;
  openingPattern: string | null;    // which bar was busiest at start
  closingPattern: string | null;    // which bar was busiest at end
  staffingInsights: string[];
}

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function buildCrowdFlowIntelligence(
  allSessions: any[],  // all sessions across ALL bars — must include barId, barName, completedAt, counts
): CrowdFlowIntelligence {

  const empty: CrowdFlowIntelligence = {
    hourSnapshots: [], flowEvents: [], peakHour: null,
    openingPattern: null, closingPattern: null, staffingInsights: [],
  };

  if (!allSessions || allSessions.length < 3) return empty;

  // Group sessions by barId, sort each group by time
  const byBar: Record<string, any[]> = {};
  for (const s of allSessions) {
    if (!s.barId || !s.completedAt?.toMillis?.()) continue;
    if (!byBar[s.barId]) byBar[s.barId] = [];
    byBar[s.barId].push(s);
  }
  for (const barId of Object.keys(byBar)) {
    byBar[barId].sort((a, b) => a.completedAt.toMillis() - b.completedAt.toMillis());
  }

  // Build hourly velocity per bar.
  // For each pair of consecutive sessions at a bar: compute total consumption,
  // assign to the hour of the later session.
  const barHourlyMap: Record<string, BarHourlyVelocity[]> = {};

  for (const [barId, sessions] of Object.entries(byBar)) {
    const barName = sessions[0].barName || barId;
    const hourMap: Record<number, { consumed: number; hours: number; sessionCount: number }> = {};

    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1];
      const curr = sessions[i];
      const prevMs = prev.completedAt.toMillis();
      const currMs = curr.completedAt.toMillis();
      const durationHours = Math.max(0.1, (currMs - prevMs) / 3_600_000);
      const hour = new Date(currMs).getHours();

      let consumed = 0;
      for (const currItem of (curr.counts || [])) {
        const prevItem = (prev.counts || []).find((p: any) => p.productId === currItem.productId);
        if (!prevItem) continue;
        const received = currItem.receivedQty ?? 0;
        consumed += Math.max(0, (prevItem.actualCount + received) - currItem.actualCount);
      }

      if (!hourMap[hour]) hourMap[hour] = { consumed: 0, hours: 0, sessionCount: 0 };
      hourMap[hour].consumed += consumed;
      hourMap[hour].hours += durationHours;
      hourMap[hour].sessionCount++;
    }

    barHourlyMap[barId] = Object.entries(hourMap).map(([h, data]) => ({
      barId,
      barName,
      hour: Number(h),
      label: hourLabel(Number(h)),
      velocity: data.hours > 0 ? data.consumed / data.hours : 0,
      consumed: data.consumed,
      sessionCount: data.sessionCount,
    }));
  }

  // Build hour snapshots across all bars
  const allHours = new Set<number>();
  for (const rows of Object.values(barHourlyMap)) {
    rows.forEach(r => allHours.add(r.hour));
  }

  const hourSnapshots: HourSnapshot[] = [...allHours].sort((a, b) => a - b).map(hour => {
    const barVelocities: Record<string, number> = {};
    let busiestBar: string | null = null;
    let busiestVelocity = 0;
    let quietestBar: string | null = null;
    let quietestVelocity = Infinity;

    for (const [barId, rows] of Object.entries(barHourlyMap)) {
      const row = rows.find(r => r.hour === hour);
      const vel = row?.velocity ?? 0;
      const barName = rows[0]?.barName || barId;
      barVelocities[barName] = vel;
      if (vel > busiestVelocity) { busiestVelocity = vel; busiestBar = barName; }
      if (vel < quietestVelocity && vel > 0) { quietestVelocity = vel; quietestBar = barName; }
    }

    return {
      hour,
      label: hourLabel(hour),
      busiestBar,
      busiestBarVelocity: busiestVelocity,
      quietestBar: quietestVelocity === Infinity ? null : quietestBar,
      barVelocities,
    };
  });

  // Detect crowd flow events — velocity leadership transitions.
  // When the busiest bar CHANGES between hours, that's a flow event.
  const flowEvents: CrowdFlowEvent[] = [];
  for (let i = 1; i < hourSnapshots.length; i++) {
    const prev = hourSnapshots[i - 1];
    const curr = hourSnapshots[i];
    if (
      prev.busiestBar && curr.busiestBar &&
      prev.busiestBar !== curr.busiestBar &&
      curr.busiestBarVelocity > 2  // minimum activity threshold
    ) {
      const velDiff = curr.busiestBarVelocity - prev.busiestBarVelocity;
      const confidence: CrowdFlowEvent['confidence'] =
        velDiff > 10 ? 'high' : velDiff > 4 ? 'medium' : 'low';

      flowEvents.push({
        fromBar: prev.busiestBar,
        toBar: curr.busiestBar,
        atHour: curr.hour,
        label: curr.label,
        confidence,
        description: `Crowd activity shifted from ${prev.busiestBar} to ${curr.busiestBar} at ${curr.label}`,
      });
    }
  }

  // Opening and closing patterns
  const firstHour = hourSnapshots[0] || null;
  const lastHour = hourSnapshots[hourSnapshots.length - 1] || null;
  const openingPattern = firstHour?.busiestBar
    ? `${firstHour.busiestBar} was busiest at opening (${firstHour.label})`
    : null;
  const closingPattern = lastHour?.busiestBar
    ? `${lastHour.busiestBar} was busiest at closing (${lastHour.label})`
    : null;

  // Staffing insights — patterns worth acting on
  const staffingInsights: string[] = [];
  const peakHour = [...hourSnapshots].sort((a, b) => b.busiestBarVelocity - a.busiestBarVelocity)[0] || null;

  if (peakHour?.busiestBar) {
    staffingInsights.push(
      `Staff up at ${peakHour.busiestBar} before ${hourLabel(peakHour.hour - 1 >= 0 ? peakHour.hour - 1 : peakHour.hour)} — peak demand hits at ${peakHour.label}`
    );
  }

  // Detect bars that consistently get quiet after their peak hour
  for (const [barId, rows] of Object.entries(barHourlyMap)) {
    const barName = rows[0]?.barName || barId;
    const sorted = [...rows].sort((a, b) => a.hour - b.hour);
    const peakRow = [...sorted].sort((a, b) => b.velocity - a.velocity)[0];
    const lastRow = sorted[sorted.length - 1];
    if (peakRow && lastRow && lastRow.velocity < peakRow.velocity * 0.3 && lastRow.hour > peakRow.hour) {
      staffingInsights.push(
        `${barName} drops to low activity after ${hourLabel(peakRow.hour)} — consider reducing staff from ${hourLabel(peakRow.hour + 1)}`
      );
    }
  }

  // Detect recurring flow patterns — same bar-to-bar transition across hours
  const transitions: Record<string, number> = {};
  for (const e of flowEvents) {
    const key = `${e.fromBar}→${e.toBar}`;
    transitions[key] = (transitions[key] || 0) + 1;
  }
  for (const [transition, count] of Object.entries(transitions)) {
    if (count >= 2) {
      staffingInsights.push(
        `Recurring crowd movement: ${transition.replace('→', ' → ')} (${count}× this event) — plan stock transfers in advance`
      );
    }
  }

  return {
    hourSnapshots,
    flowEvents,
    peakHour,
    openingPattern,
    closingPattern,
    staffingInsights,
  };
}
