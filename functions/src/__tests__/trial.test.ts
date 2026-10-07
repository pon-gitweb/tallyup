import { shouldStartTrial, computeTrialCountUpdate, FOUNDER_UIDS } from "../trial";

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
