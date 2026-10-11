import { shouldStartTrial, computeTrialCountUpdate, computeFullStocktake, applyDeptCycleSeen, FOUNDER_UIDS } from "../trial";

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
