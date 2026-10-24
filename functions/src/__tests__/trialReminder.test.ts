import {
  shouldSendTrialReminder,
  THIRTY_DAYS_MS,
  EIGHT_DAYS_MS,
} from "../trialReminderLogic";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LEAD = THIRTY_DAYS_MS - EIGHT_DAYS_MS; // reminder opens 22 days after start

// Local hour and date of a UTC instant in Pacific/Auckland.
function nzParts(ms: number): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// UTC instant of 09:00 Pacific/Auckland on the given NZ calendar date.
function nzNineAm(y: number, m: number, d: number): number {
  for (const utcHour of [20, 21]) { // NZDT = UTC+13, NZST = UTC+12
    const ms = Date.UTC(y, m - 1, d - 1, utcHour);
    const nz = nzParts(ms);
    const want = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (nz.hour === 9 && nz.date === want) return ms;
  }
  throw new Error(`no 09:00 NZ instant for ${y}-${m}-${d}`);
}

function nzRuns(fromY: number, fromM: number, fromD: number, days: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const base = new Date(Date.UTC(fromY, fromM - 1, fromD + i));
    out.push(nzNineAm(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()));
  }
  return out;
}

function utcRuns(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  let t = Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), new Date(fromMs).getUTCDate(), 9);
  if (t < fromMs) t += DAY;
  for (; t <= toMs; t += DAY) out.push(t);
  return out;
}

// Replays scheduled runs against a set of trials, stamping reminderSentAt the way
// the function does. Returns how many sends each trial got, and when.
function simulate(runs: number[], startTimes: number[]) {
  const sent = startTimes.map(() => [] as number[]);
  for (const run of [...runs].sort((a, b) => a - b)) {
    startTimes.forEach((startMs, i) => {
      const trial = {
        status: "active",
        reminderSentAt: sent[i].length ? { stamped: true } : undefined,
        startMs,
        stocktakesUsed: 0,
      };
      if (shouldSendTrialReminder(trial, run)) sent[i].push(run);
    });
  }
  return sent;
}

describe("shouldSendTrialReminder", () => {
  const start = Date.UTC(2026, 9, 1, 3, 17);
  it("not before the 22-day mark", () => {
    expect(shouldSendTrialReminder({ status: "active", startMs: start, stocktakesUsed: 0 }, start + LEAD - 1)).toBe(false);
  });
  it("from the 22-day mark (elapsed ms, not calendar days)", () => {
    expect(shouldSendTrialReminder({ status: "active", startMs: start, stocktakesUsed: 0 }, start + LEAD)).toBe(true);
  });
  it("on the stocktake trigger regardless of time", () => {
    expect(shouldSendTrialReminder({ status: "active", startMs: start, stocktakesUsed: 2 }, start + HOUR)).toBe(true);
  });
  it("never when already sent or not active", () => {
    expect(shouldSendTrialReminder({ status: "active", reminderSentAt: {}, startMs: start, stocktakesUsed: 2 }, start + LEAD)).toBe(false);
    expect(shouldSendTrialReminder({ status: "converted", startMs: start, stocktakesUsed: 2 }, start + LEAD)).toBe(false);
  });
  it("is independent of the time of day it runs", () => {
    // Same elapsed time, run at different wall-clock hours: same answer.
    for (let h = 0; h < 24; h++) {
      const s = Date.UTC(2026, 9, 1, h);
      expect(shouldSendTrialReminder({ status: "active", startMs: s, stocktakesUsed: 0 }, s + LEAD)).toBe(true);
      expect(shouldSendTrialReminder({ status: "active", startMs: s, stocktakesUsed: 0 }, s + LEAD - 1)).toBe(false);
    }
  });
});

describe("schedule changeover 09:00 UTC -> 09:00 Pacific/Auckland", () => {
  // Trials whose reminder window opens every 20 minutes across 19-26 Oct 2026.
  const opens: number[] = [];
  for (let t = Date.UTC(2026, 9, 19); t < Date.UTC(2026, 9, 26); t += 20 * 60 * 1000) opens.push(t);
  const starts = opens.map((o) => o - LEAD);

  // Deploy at different moments of 22 Oct UTC, before and after the old 09:00 UTC run.
  for (const deployHourUtc of [0, 8, 9.5, 12, 19.5, 23]) {
    it(`each trial is sent exactly once, at the first run after its window opens (deploy ${deployHourUtc}:00 UTC 22 Oct)`, () => {
      const deploy = Date.UTC(2026, 9, 22) + deployHourUtc * HOUR;
      const oldRuns = utcRuns(Date.UTC(2026, 9, 15), deploy);
      const newRuns = nzRuns(2026, 10, 20, 12).filter((r) => r > deploy);
      const runs = [...oldRuns, ...newRuns].sort((a, b) => a - b);
      const sent = simulate(runs, starts);

      sent.forEach((s, i) => {
        expect(s).toHaveLength(1); // no skip, no double send
        const firstEligibleRun = runs.find((r) => r >= opens[i]);
        expect(s[0]).toBe(firstEligibleRun);
      });
      // A trial never waits longer than the longest gap between two consecutive runs.
      // That gap is 11h if you deploy between the old run (09:00 UTC) and the first
      // new run (20:00 UTC = 09:00 NZDT), and up to 35h otherwise. A later send, never a missed one.
      const gaps = runs.slice(1).map((r, i) => r - runs[i]);
      const maxWait = Math.max(...sent.map((s, i) => s[0] - opens[i]));
      expect(maxWait).toBeLessThanOrEqual(Math.max(...gaps));
      expect(Math.max(...gaps)).toBeLessThanOrEqual(35 * HOUR);
      const inWindow = deployHourUtc >= 9 && deployHourUtc < 20;
      expect(Math.max(...gaps)).toBe(inWindow ? 24 * HOUR : 35 * HOUR);
    });
  }
});

describe("daylight saving", () => {
  const cases: Array<[string, [number, number, number], number]> = [
    ["NZDT ends 5 Apr 2026", [2026, 3, 28], 16],
    ["NZDT starts 27 Sep 2026", [2026, 9, 20], 16],
  ];
  for (const [label, [y, m, d], days] of cases) {
    it(`${label}: one run per NZ day at 09:00 local, 23-25h apart`, () => {
      const runs = nzRuns(y, m, d, days);
      const dates = runs.map((r) => nzParts(r).date);
      expect(new Set(dates).size).toBe(days);
      runs.forEach((r) => expect(nzParts(r).hour).toBe(9));
      const gaps = runs.slice(1).map((r, i) => (r - runs[i]) / HOUR);
      gaps.forEach((g) => expect([23, 24, 25]).toContain(g));
      expect(gaps.some((g) => g !== 24)).toBe(true); // the DST day really is in range
    });
    it(`${label}: every trial sent exactly once, within 25h of its window opening`, () => {
      const runs = nzRuns(y, m, d, days);
      const opens: number[] = [];
      for (let t = runs[0] - DAY; t < runs[runs.length - 2]; t += 15 * 60 * 1000) opens.push(t);
      const sent = simulate(runs, opens.map((o) => o - LEAD));
      sent.forEach((s, i) => {
        expect(s).toHaveLength(1);
        expect(s[0] - opens[i]).toBeLessThanOrEqual(25 * HOUR);
        expect(s[0]).toBe(runs.find((r) => r >= opens[i]));
      });
    });
  }
});
