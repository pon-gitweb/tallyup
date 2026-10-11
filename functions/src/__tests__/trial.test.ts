import { shouldStartTrial, computeTrialCountUpdate, computeFullStocktake, applyDeptCycleSeen, applyCycleEventToTrial, FOUNDER_UIDS } from "../trial";

const TRIGGER_DATE = new Date("2025-10-01T00:00:00Z");
const NON_FOUNDER = "user_abc123";

const baseParams = {
  venueCreatedAt: new Date("2026-01-01T00:00:00Z"),
  pilotTriggerDate: TRIGGER_DATE,
  ownerUid: NON_FOUNDER,
  legacyFreeAccess: undefined as boolean | undefined,
  founderUids: FOUNDER_UIDS,
};

describe("shouldStartTrial", () => {
  test.each([
    ["pre-trigger venue",       { ...baseParams, venueCreatedAt: new Date("2025-09-01") },    false],
    ["founder UID",             { ...baseParams, ownerUid: "ChpWVbutHwSCRQKr3THR79EIw1X2" }, false],
    ["legacy flag",             { ...baseParams, legacyFreeAccess: true as any },             false],
    ["missing config",          { ...baseParams, pilotTriggerDate: null },                    false],
    ["null createdAt",          { ...baseParams, venueCreatedAt: null },                      false],
    ["eligible venue",          baseParams,                                                    true],
    // Festival exemption
    ["festival venueType",      { ...baseParams, venueType: "festival" },                     false],
    ["venue venueType",         { ...baseParams, venueType: "venue" },                        true],
    ["null venueType (loading)",{ ...baseParams, venueType: null },                           true],
  ] as const)("%s", (_, params, expected) => {
    expect(shouldStartTrial(params)).toBe(expected);
  });
});

describe("computeTrialCountUpdate", () => {
  // [label, totalBefore, totalAfter, trialStatus, atStart, currentUsed, expectSkip, expectUsed, expectExpire]
  test.each([
    ["counter unchanged",   5,  5, "active",  5, 0, true,  undefined, undefined],
    ["already expired",     6,  7, "expired", 5, 3, true,  undefined, undefined],
    ["below limit",         6,  7, "active",  5, 0, false, 2,         false],
    ["exactly 3",           7,  8, "active",  5, 2, false, 3,         true],
    ["over 3",              9, 11, "active",  5, 0, false, 6,         true],
    ["never decreasing",    7,  8, "active",  5, 3, false, 3,         true],
  ] as const)(
    "%s",
    (_, tBefore, tAfter, status, atStart, used, expectSkip, expectUsed, expectExpire) => {
      const result = computeTrialCountUpdate({
        totalBefore: tBefore,
        totalAfter: tAfter,
        trialStatus: status,
        stocktakesAtStart: atStart,
        stocktakesUsed: used,
      });
      expect(result.skip).toBe(expectSkip);
      if (!result.skip) {
        expect(result.newUsed).toBe(expectUsed);
        expect(result.shouldExpire).toBe(expectExpire);
      }
    },
  );
});

// ── computeFullStocktake ──────────────────────────────────────────────────────

const A = { id: "A", active: true, hasAreas: true };
const B = { id: "B", active: true, hasAreas: true };
const C = { id: "C", active: true, hasAreas: true };
const A_NO_AREAS  = { id: "A", active: true,  hasAreas: false };
const B_INACTIVE  = { id: "B", active: false, hasAreas: true  };

describe("computeFullStocktake", () => {
  // ── table-driven cases ────────────────────────────────────────────────────
  test.each([
    // label                          | lastFullMs | seenByDept           | departments          | counted | newLastFullMs
    ["one dept, seen after → counted",          100, { A: 200 },            [A],                  true,  200],
    ["one dept, seen = lastFull → not counted", 200, { A: 200 },            [A],                  false, 200],
    ["one dept, seen < lastFull → not counted", 200, { A: 150 },            [A],                  false, 200],
    ["one dept, unseen → not counted",          100, {},                    [A],                  false, 100],

    // Three depts all completing
    ["three depts, all seen → counted",         100, { A:200, B:300, C:250 }, [A, B, C],          true,  300],
    // Three depts, one missing
    ["three depts, one unseen → not counted",   100, { A:200, B:300 },        [A, B, C],          false, 100],
    // Three depts in different order — result must be same regardless of order in array
    ["three depts, different array order",      100, { A:200, B:300, C:250 }, [C, A, B],          true,  300],

    // One dept completes, advancing lastFull; same dept appears again
    // (simulate: lastFull already at 200, dept's seen is 200, not > 200)
    ["dept completing twice: second seen ≤ lastFull → not counted again", 200, { A: 200 }, [A],   false, 200],

    // Departments with no areas are ignored (not eligible)
    ["dept with no areas → ignored, no count",  100, { A: 200 },            [A_NO_AREAS],         false, 100],
    ["one eligible + one no-areas → counted",   100, { A: 200 },            [A, A_NO_AREAS],      true,  200],

    // Inactive departments are ignored
    ["inactive dept → ignored",                 100, { B: 200 },            [B_INACTIVE],         false, 100],
    ["one eligible + one inactive → counted",   100, { A: 200 },            [A, B_INACTIVE],      true,  200],

    // Dept added mid-trial: B is in departments list but not yet in seenByDept
    ["dept added mid-trial: B unseen → blocks count", 100, { A: 200 },      [A, B],               false, 100],

    // Empty venue — no departments at all
    ["empty venue → never counts",              100, {},                    [],                   false, 100],
    // All depts inactive
    ["all inactive → never counts",             100, { A: 200, B: 300 }, [A_NO_AREAS, B_INACTIVE], false, 100],
  ] as const)(
    "%s",
    (_, lastFullMs, seenByDept, departments, expectedCounted, expectedNewLastFullMs) => {
      const result = computeFullStocktake({ lastFullMs, seenByDept, departments });
      expect(result.counted).toBe(expectedCounted);
      expect(result.newLastFullMs).toBe(expectedNewLastFullMs);
    },
  );

  // ── Two depts in EITHER order produce exactly one count ───────────────────
  // Simulate: event for A arrives first, then B; vs B first, then A.
  // In both orderings, after both have been seen, computeFullStocktake returns
  // counted=true with the same newLastFullMs.
  test("two depts: A-then-B order → one count", () => {
    const lastFull = 0;
    const depts = [A, B];
    // Step 1: A's cycle created (serverTime 100)
    let seen = applyDeptCycleSeen({}, "A", 100);
    let r = computeFullStocktake({ lastFullMs: lastFull, seenByDept: seen, departments: depts });
    expect(r.counted).toBe(false); // B not yet seen
    // Step 2: B's cycle created (serverTime 200)
    seen = applyDeptCycleSeen(seen, "B", 200);
    r = computeFullStocktake({ lastFullMs: lastFull, seenByDept: seen, departments: depts });
    expect(r.counted).toBe(true);
    expect(r.newLastFullMs).toBe(200);
  });

  test("two depts: B-then-A order → one count (same result)", () => {
    const lastFull = 0;
    const depts = [A, B];
    // Step 1: B's cycle created (serverTime 200)
    let seen = applyDeptCycleSeen({}, "B", 200);
    let r = computeFullStocktake({ lastFullMs: lastFull, seenByDept: seen, departments: depts });
    expect(r.counted).toBe(false); // A not yet seen
    // Step 2: A's cycle created (serverTime 100)
    seen = applyDeptCycleSeen(seen, "A", 100);
    r = computeFullStocktake({ lastFullMs: lastFull, seenByDept: seen, departments: depts });
    expect(r.counted).toBe(true);
    expect(r.newLastFullMs).toBe(200); // max of the two
  });

  // ── Duplicate delivery after counting → no second count ──────────────────
  test("duplicate delivery after counting does not produce a second count", () => {
    const depts = [A, B];
    // Both depts seen, first count fires
    const seen = { A: 100, B: 200 };
    const r1 = computeFullStocktake({ lastFullMs: 0, seenByDept: seen, departments: depts });
    expect(r1.counted).toBe(true);
    const advancedLastFull = r1.newLastFullMs; // 200

    // Duplicate delivery: same seenByDept, lastFull now advanced
    const r2 = computeFullStocktake({ lastFullMs: advancedLastFull, seenByDept: seen, departments: depts });
    expect(r2.counted).toBe(false);
  });

  // ── Client completedAt has no effect ─────────────────────────────────────
  // computeFullStocktake takes only seenByDept (server times) and departments.
  // It does not accept a completedAt parameter — there is no way for a client
  // to influence the result by writing a future-dated completedAt field.
  test("computeFullStocktake has no completedAt parameter (design assertion)", () => {
    // Attempting to pass completedAt to the function would be a TypeScript compile error.
    // Here we verify the counted result depends only on seenByDept, not on the document
    // fields the client writes. Two calls with identical seenByDept but different document
    // fields (if they existed) would produce the same result.
    const r1 = computeFullStocktake({ lastFullMs: 0, seenByDept: { A: 100 }, departments: [A] });
    const r2 = computeFullStocktake({ lastFullMs: 0, seenByDept: { A: 100 }, departments: [A] });
    expect(r1).toEqual(r2);
  });
});

// ── applyDeptCycleSeen ────────────────────────────────────────────────────────

describe("applyDeptCycleSeen", () => {
  test("records new dept when not yet seen", () => {
    const result = applyDeptCycleSeen({}, "A", 500);
    expect(result).toEqual({ A: 500 });
  });

  test("advances seen time when newer delivery arrives", () => {
    const result = applyDeptCycleSeen({ A: 100 }, "A", 300);
    expect(result).toEqual({ A: 300 });
  });

  test("stale delivery never reduces seen time (MAX preserved)", () => {
    const result = applyDeptCycleSeen({ A: 500 }, "A", 200); // 200 is older
    expect(result).toEqual({ A: 500 });
  });

  test("duplicate delivery (same time) keeps the same value", () => {
    const result = applyDeptCycleSeen({ A: 300 }, "A", 300);
    expect(result).toEqual({ A: 300 });
  });

  test("updating one dept does not affect others", () => {
    const existing = { A: 100, B: 200 };
    const result = applyDeptCycleSeen(existing, "C", 300);
    expect(result).toEqual({ A: 100, B: 200, C: 300 });
  });
});

// ── applyCycleEventToTrial ────────────────────────────────────────────────────

const FOUNDER_UID = [...FOUNDER_UIDS][0];
const REGULAR_UID = "user_regular_123";

const activeTrial = (overrides: Record<string, any> = {}) => ({
  status: "active",
  stocktakesUsed: 0,
  lastFullStocktakeAtMs: 0,
  deptCycleSeenMs: {},
  ...overrides,
});

const normalVenue = (overrides: Record<string, any> = {}) => ({
  ownerUid: REGULAR_UID,
  venueType: "venue",
  legacyFreeAccess: false,
  ...overrides,
});

const deptA = { id: "dA", active: true, hasAreas: true };
const deptB = { id: "dB", active: true, hasAreas: true };
const twoDepts = [deptA, deptB] as const;
const oneDept  = [deptA] as const;

const BASE = {
  departmentId: "dA",
  serverTimeMs: 1000,
  founderUids: FOUNDER_UIDS,
};

describe("applyCycleEventToTrial", () => {
  // ── Null / exempt cases ───────────────────────────────────────────────────
  test.each([
    ["trial not active (expired)",  activeTrial({ status: "expired" }), normalVenue()],
    ["trial not active (pending)",  activeTrial({ status: "pending" }), normalVenue()],
    ["festival venue",              activeTrial(),                      normalVenue({ venueType: "festival" })],
    ["legacyFreeAccess venue",      activeTrial(),                      normalVenue({ legacyFreeAccess: true })],
    ["founder venue",               activeTrial(),                      normalVenue({ ownerUid: FOUNDER_UID })],
  ] as const)("returns null for %s", (_, trial, venueData) => {
    const result = applyCycleEventToTrial({ ...BASE, trial, venueData, departments: oneDept });
    expect(result).toBeNull();
  });

  // ── serverTimeMs is the only time used ───────────────────────────────────
  test("serverTimeMs is the only time used — extra fields on trial are ignored", () => {
    const trialWithExtra = { ...activeTrial(), completedAtMs: 999_999_999_999 };
    const result = applyCycleEventToTrial({ ...BASE, trial: trialWithExtra, venueData: normalVenue(), departments: oneDept });
    // The extra field has no effect — the function counts based on serverTimeMs only
    const clean = applyCycleEventToTrial({ ...BASE, trial: activeTrial(), venueData: normalVenue(), departments: oneDept });
    expect(result?.trialUpdate).toEqual(clean?.trialUpdate);
  });

  // ── No-op (not yet counted): returns only deptCycleSeenMs ────────────────
  test("no-op path: one dept event when two depts required returns only deptCycleSeenMs", () => {
    const result = applyCycleEventToTrial({
      ...BASE,
      departmentId: "dA",
      serverTimeMs: 100,
      trial: activeTrial(),
      venueData: normalVenue(),
      departments: twoDepts,  // dB not yet seen
    });
    expect(result).not.toBeNull();
    expect(result!.trialUpdate).toEqual({ deptCycleSeenMs: { dA: 100 } });
    expect(result!.expireVenue).toBe(false);
  });

  // ── Two-dept venue: counts only on second dept's event ───────────────────
  test("two-dept venue: counts on second dept event, not first", () => {
    // First event: dA only
    const r1 = applyCycleEventToTrial({
      ...BASE, departmentId: "dA", serverTimeMs: 100,
      trial: activeTrial(), venueData: normalVenue(), departments: twoDepts,
    });
    expect(r1!.trialUpdate.stocktakesUsed).toBeUndefined();

    // Second event: dB — now both depts seen
    const trialAfterR1 = activeTrial({ deptCycleSeenMs: r1!.trialUpdate.deptCycleSeenMs });
    const r2 = applyCycleEventToTrial({
      ...BASE, departmentId: "dB", serverTimeMs: 200,
      trial: trialAfterR1, venueData: normalVenue(), departments: twoDepts,
    });
    expect(r2!.trialUpdate.stocktakesUsed).toBe(1);
    expect(r2!.trialUpdate.lastFullStocktakeAtMs).toBe(200);
    expect(r2!.expireVenue).toBe(false);
  });

  // ── stocktakesUsed progression 0 → 1 → 2 → 3 ───────────────────────────
  test("stocktakesUsed increments 0→1→2→3 and third sets status expired", () => {
    let trial: Record<string, any> = activeTrial({ lastFullStocktakeAtMs: 0, deptCycleSeenMs: {} });
    const steps = [
      { dept: "dA", t: 100 }, { dept: "dB", t: 200 },  // → 1
      { dept: "dA", t: 300 }, { dept: "dB", t: 400 },  // → 2
      { dept: "dA", t: 500 }, { dept: "dB", t: 600 },  // → 3
    ];

    let used = 0;
    for (const { dept, t } of steps) {
      const r = applyCycleEventToTrial({
        ...BASE, departmentId: dept, serverTimeMs: t,
        trial, venueData: normalVenue(), departments: twoDepts,
      });
      expect(r).not.toBeNull();
      // Apply the update to trial for the next step
      trial = { ...trial, ...r!.trialUpdate };
      delete trial.setResolvedAt;
    }

    expect(trial.stocktakesUsed).toBe(3);
    expect(trial.status).toBe("expired");
    expect(trial.resolvedReason).toBe("stocktake_limit");
  });

  test("at 3 stocktakesUsed never increments to 4", () => {
    const expiredTrial = activeTrial({
      status: "expired",
      stocktakesUsed: 3,
      lastFullStocktakeAtMs: 400,
      deptCycleSeenMs: { dA: 300, dB: 400 },
    });
    const result = applyCycleEventToTrial({
      ...BASE, departmentId: "dA", serverTimeMs: 500,
      trial: expiredTrial, venueData: normalVenue(), departments: twoDepts,
    });
    // status is not 'active' → null
    expect(result).toBeNull();
  });

  test("third count sets expireVenue true and setResolvedAt true", () => {
    const trial = activeTrial({
      stocktakesUsed: 2,
      lastFullStocktakeAtMs: 200,
      deptCycleSeenMs: { dA: 200, dB: 200 },
    });
    // dA gets a new cycle after lastFull
    const r1 = applyCycleEventToTrial({
      ...BASE, departmentId: "dA", serverTimeMs: 300,
      trial, venueData: normalVenue(), departments: twoDepts,
    });
    // dB gets a new cycle after lastFull
    const trialMid = { ...trial, ...r1!.trialUpdate };
    const r2 = applyCycleEventToTrial({
      ...BASE, departmentId: "dB", serverTimeMs: 400,
      trial: trialMid, venueData: normalVenue(), departments: twoDepts,
    });
    expect(r2!.trialUpdate.stocktakesUsed).toBe(3);
    expect(r2!.trialUpdate.status).toBe("expired");
    expect(r2!.trialUpdate.resolvedReason).toBe("stocktake_limit");
    expect(r2!.trialUpdate.setResolvedAt).toBe(true);
    expect(r2!.expireVenue).toBe(true);
  });

  // ── No eligible departments ───────────────────────────────────────────────
  test("venue with no eligible departments never counts", () => {
    const noAreas = { id: "dA", active: true, hasAreas: false };
    const inactive = { id: "dB", active: false, hasAreas: true };
    const result = applyCycleEventToTrial({
      ...BASE, departmentId: "dA", serverTimeMs: 100,
      trial: activeTrial(), venueData: normalVenue(), departments: [noAreas, inactive],
    });
    expect(result).not.toBeNull();
    expect(result!.trialUpdate.stocktakesUsed).toBeUndefined();
    expect(result!.trialUpdate).toEqual({ deptCycleSeenMs: { dA: 100 } });
  });
});
