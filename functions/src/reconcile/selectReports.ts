/**
 * Pure report-selection logic: given window dates and a list of active reports,
 * classify each as attached, partial, or conflicting.
 * No Firebase imports.
 */

import { toTzDate } from './tradingWindow';

export interface ReportPeriod {
  id: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface SelectResult {
  attached: ReportPeriod[];
  partial: ReportPeriod[];
  conflicts: ReportPeriod[];
  uncoveredDates: string[];
  coverageComplete: boolean;
}

/**
 * Classify reports against the trading window.
 *
 * A report ATTACHES only if all its trading dates (period dates in tz, minus
 * closedWeekdays) are in the window.
 * Partly-overlapping reports are "partial" (not attached).
 * If two attached-candidate reports share a trading date: both become "conflict",
 * and neither attaches.
 */
export function selectReports(
  window: string[],
  tz: string,
  closedWeekdays: number[],
  reports: ReportPeriod[],
): SelectResult {
  const windowSet = new Set(window);
  const closedSet = new Set(closedWeekdays);

  // Compute each report's trading dates
  const reportDatesMap = new Map<string, string[]>();
  for (const r of reports) {
    reportDatesMap.set(r.id, tradingDates(r.periodStart, r.periodEnd, tz, closedSet));
  }

  // Classify: candidate (all in window) vs partial (some in window)
  const candidates: ReportPeriod[] = [];
  const partial: ReportPeriod[] = [];

  for (const r of reports) {
    const dates = reportDatesMap.get(r.id) ?? [];
    if (dates.length === 0) continue;
    const allIn = dates.every(d => windowSet.has(d));
    const someIn = dates.some(d => windowSet.has(d));
    if (allIn) {
      candidates.push(r);
    } else if (someIn) {
      partial.push(r);
    }
  }

  // Among candidates: find which ones share a trading date
  const dateToIds = new Map<string, string[]>();
  for (const r of candidates) {
    for (const d of reportDatesMap.get(r.id) ?? []) {
      if (!dateToIds.has(d)) dateToIds.set(d, []);
      dateToIds.get(d)!.push(r.id);
    }
  }

  const conflictingIds = new Set<string>();
  for (const [, ids] of dateToIds) {
    if (ids.length > 1) ids.forEach(id => conflictingIds.add(id));
  }

  const conflicts = candidates.filter(r => conflictingIds.has(r.id));
  const attached = candidates.filter(r => !conflictingIds.has(r.id));

  // Uncovered dates: window dates not covered by any attached report
  const coveredDates = new Set<string>();
  for (const r of attached) {
    for (const d of reportDatesMap.get(r.id) ?? []) coveredDates.add(d);
  }

  const uncoveredDates = window.filter(d => !coveredDates.has(d));

  return {
    attached,
    partial,
    conflicts,
    uncoveredDates,
    coverageComplete: uncoveredDates.length === 0,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function tradingDates(
  periodStart: Date,
  periodEnd: Date,
  tz: string,
  closedSet: Set<number>,
): string[] {
  const startStr = toTzDate(periodStart, tz);
  const endStr = toTzDate(periodEnd, tz);
  const dates: string[] = [];

  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    if (!closedSet.has(cur.getUTCDay())) dates.push(dateStr);
    cur = new Date(cur.getTime() + 86_400_000);
  }

  return dates;
}
