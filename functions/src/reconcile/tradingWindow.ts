/**
 * Pure trading-window date logic.
 * No Firebase imports.
 */

/**
 * Returns the list of YYYY-MM-DD trading dates in the venue timezone for the
 * period between the opening count and this count.
 *
 * pre_service: from the opening count's date up to the day BEFORE this count's date.
 * post_service: from the day AFTER the opening count's date up to this count's date.
 *
 * Dates that fall on a closedWeekday are removed from the result.
 * closedWeekdays: 0=Sun, 1=Mon, ..., 6=Sat.
 */
export function windowDates(
  openingCountStart: Date,
  thisCountStart: Date,
  tz: string,
  closedWeekdays: number[],
  countTiming: 'pre_service' | 'post_service',
): string[] {
  const openDate = toTzDate(openingCountStart, tz);
  const thisDate = toTzDate(thisCountStart, tz);

  let startStr: string;
  let endStr: string;

  if (countTiming === 'pre_service') {
    startStr = openDate;
    endStr = addDays(thisDate, -1);
  } else {
    startStr = addDays(openDate, 1);
    endStr = thisDate;
  }

  const closedSet = new Set(closedWeekdays);
  const dates: string[] = [];

  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    if (!closedSet.has(cur.getUTCDay())) {
      dates.push(dateStr);
    }
    cur = new Date(cur.getTime() + 86_400_000);
  }

  return dates;
}

/**
 * Returns ALL calendar dates (no closed-weekday removal) in the venue timezone
 * for the delivery window. Goods may arrive on days the venue is closed for service.
 *
 * pre_service: opening count date through day before this count date.
 *   (The count day itself belongs to the next period.)
 * post_service: day after opening count date through this count date.
 */
export function deliveryDates(
  openingCountStart: Date,
  thisCountStart: Date,
  tz: string,
  countTiming: 'pre_service' | 'post_service',
): string[] {
  const openDate = toTzDate(openingCountStart, tz);
  const thisDate = toTzDate(thisCountStart, tz);

  const startStr = countTiming === 'pre_service' ? openDate : addDays(openDate, 1);
  const endStr   = countTiming === 'pre_service' ? addDays(thisDate, -1) : thisDate;

  const dates: string[] = [];
  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }

  return dates;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function toTzDate(date: Date, tz: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
