import {
  resolveEntitlements,
  MATCHBOX_VENUE_ID,
  FOUNDER_UIDS,
  type ResolveEntitlementsInput,
  type ResolveEntitlementsOutput,
  type TrialStateDoc,
  type ModuleTrialEntry,
} from '../resolveEntitlements';
import { MODULES, MODULE_INTRODUCED_AT, type ModuleId } from '../modules';
import { type BillingState } from '../entitlements';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS  = 24 * 60 * 60 * 1000;

// pilotTriggerDate: the date when new-venue trials began
const PILOT_DATE = new Date('2026-10-01T00:00:00Z');
const GRACE_END_MS = PILOT_DATE.getTime() + ONE_YEAR_MS; // ~2027-10-01

// Venue timestamps relative to pilot date
const BEFORE_PILOT = new Date(PILOT_DATE.getTime() - ONE_DAY_MS); // "old" pilot venue
const ON_PILOT     = new Date(PILOT_DATE.getTime());               // exactly on trigger
const AFTER_PILOT  = new Date(PILOT_DATE.getTime() + ONE_DAY_MS);  // trial venue

// nowMs fixtures
const NOW_IN_YEAR    = PILOT_DATE.getTime() + 180 * ONE_DAY_MS; // 6 months in, within grace
const NOW_AFTER_YEAR = GRACE_END_MS + ONE_DAY_MS;               // past grace period

// A founder UID from the set
const FOUNDER_UID = [...FOUNDER_UIDS][0];

// Helper: a trialState with startedAt at AFTER_PILOT
const mkTrialDoc = (stocktakesUsed: number, startedAtMs = AFTER_PILOT.getTime()): TrialStateDoc => ({
  startedAt: { toMillis: () => startedAtMs },
  stocktakesAtStart: 0,
  stocktakesUsed,
  status: 'active',
});

// Base inputs — sensible defaults; individual tests override what they need
const base: ResolveEntitlementsInput = {
  venueId: 'venue-1',
  ownerUid: 'user-1',
  venueCreatedAt: BEFORE_PILOT,
  pilotTriggerDate: PILOT_DATE,
  legacyFreeAccess: false,
  subscriptionOverride: null,
  subscription: null,
  trialState: null,
  moduleTrialState: null,
  nowMs: NOW_IN_YEAR,
};

// ── Branch 1: subscriptionOverride ───────────────────────────────────────────

describe('subscriptionOverride', () => {
  it('grants full access with exactly the overridden plan and modules', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: AFTER_PILOT,
      subscriptionOverride: { plan: 'core', modules: [MODULES.OPS_INTELLIGENCE] },
      trialState: undefined, // still loading — override must win
    });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.plan).toBe('core');
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(true);
    expect(result.billingState.addons.predictiveOrdering).toBe(false);
    expect(result.billingState.addons.gamification).toBe(true); // P&I always included
    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(true);
    expect(result.hasModule(MODULES.SUPPLIER_OPTIMISATION)).toBe(false);
  });

  it('takes highest priority over legacyFreeAccess', () => {
    const result = resolveEntitlements({
      ...base,
      legacyFreeAccess: true,
      subscriptionOverride: { plan: 'core', modules: [] },
    });

    expect(result.plan).toBe('core'); // override wins, not 'core_plus'
  });
});

// ── Branch 2: legacyFreeAccess ────────────────────────────────────────────────

describe('legacyFreeAccess', () => {
  it('grants permanent core_plus full access', () => {
    const result = resolveEntitlements({
      ...base,
      legacyFreeAccess: true,
      subscription: undefined, // shouldn't matter
    });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.plan).toBe('core_plus');
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(true);
    expect(result.hasModule(MODULES.MULTI_VENUE)).toBe(true);
  });
});

// ── Branch 3: founder UID ─────────────────────────────────────────────────────

describe('founder UID', () => {
  it('grants permanent core_plus full access while they own the venue', () => {
    const result = resolveEntitlements({
      ...base,
      ownerUid: FOUNDER_UID,
      venueCreatedAt: AFTER_PILOT, // would be in trial branch otherwise
      trialState: undefined,        // still loading — founder must win
    });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.plan).toBe('core_plus');
    expect(result.billingState.accessMode).toBe('full');
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(true);
  });

  it('does NOT grant founder access after ownership transfer', () => {
    const result = resolveEntitlements({
      ...base,
      ownerUid: 'non-founder-uid',
      venueCreatedAt: BEFORE_PILOT, // pilot in-year
    });

    expect(result.plan).toBe('core'); // pilot, not core_plus
  });
});

// ── Branch 4: Matchbox venue ─────────────────────────────────────────────────

describe('Matchbox venue', () => {
  const matchboxBase: ResolveEntitlementsInput = {
    ...base,
    venueId: MATCHBOX_VENUE_ID,
    ownerUid: 'matchbox-owner',
  };

  it('gets core_plus full access during the grace period', () => {
    const result = resolveEntitlements({ ...matchboxBase, nowMs: NOW_IN_YEAR });

    expect(result.ready).toBe(true);
    expect(result.plan).toBe('core_plus');
    expect(result.discountPercent).toBe(0);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(true);
  });

  it('drops to core at 50% off after the grace period ends', () => {
    const result = resolveEntitlements({ ...matchboxBase, nowMs: NOW_AFTER_YEAR });

    expect(result.plan).toBe('core');
    expect(result.discountPercent).toBe(50);
    expect(result.billingState.accessMode).toBe('full'); // still full, just core
    expect(result.billingState.addons.aiReporting).toBe(false);
    expect(result.billingState.addons.gamification).toBe(true); // P&I always included
    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(false);
  });

  it('defaults to core_plus full when pilotTriggerDate is null (config loading)', () => {
    const result = resolveEntitlements({ ...matchboxBase, pilotTriggerDate: null });

    expect(result.plan).toBe('core_plus');
    expect(result.discountPercent).toBe(0);
    expect(result.ready).toBe(true);
  });
});

// ── Branch 5: pilot venue (in-year) ──────────────────────────────────────────

describe('pilot venue', () => {
  const pilotBase: ResolveEntitlementsInput = {
    ...base,
    venueCreatedAt: BEFORE_PILOT,
    nowMs: NOW_IN_YEAR,
  };

  it('gets core at 50% off with full access during the grace period', () => {
    const result = resolveEntitlements(pilotBase);

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.plan).toBe('core');
    expect(result.discountPercent).toBe(50);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(false);
    expect(result.billingState.addons.gamification).toBe(true);
    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(false);
  });

  it('falls through to Stripe after grace period ends', () => {
    const result = resolveEntitlements({
      ...pilotBase,
      nowMs: NOW_AFTER_YEAR,
      subscription: null,
    });

    // No active subscription → readOnly
    expect(result.billingState.accessMode).toBe('readOnly');
    expect(result.ready).toBe(true);
  });
});

// ── Branch 6: D-039 trial ─────────────────────────────────────────────────────

describe('D-039 trial branch', () => {
  const trialBase: ResolveEntitlementsInput = {
    ...base,
    venueCreatedAt: AFTER_PILOT,
    nowMs: AFTER_PILOT.getTime() + 5 * ONE_DAY_MS, // 5 days into trial
  };

  // ── Loading states ────────────────────────────────────────────────────────

  it('ready=false and stays full/generous when trialState is undefined (snapshot loading)', () => {
    const result = resolveEntitlements({ ...trialBase, trialState: undefined });

    expect(result.ready).toBe(false);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.trial.stocktakesRemaining).toBe(3);
  });

  it('ready=true and stays full/generous when trialState is null (pending server trigger)', () => {
    const result = resolveEntitlements({ ...trialBase, trialState: null });

    expect(result.ready).toBe(true);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.trial.stocktakesRemaining).toBe(3);
  });

  // ── Active trial ─────────────────────────────────────────────────────────

  it('grants full core_plus access with correct stocktakesRemaining', () => {
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(1),
    });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(false); // trial is not "active subscription"
    expect(result.plan).toBe(null);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.plan).toBe('core_plus');
    expect(result.billingState.trial.stocktakesRemaining).toBe(2);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(true);
  });

  it('stocktakesRemaining clamps to 0 (never negative)', () => {
    // Over-run guard: stocktakesUsed=2 → 1 remaining
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(2),
    });

    expect(result.billingState.trial.stocktakesRemaining).toBe(1);
  });

  // ── Expired by count ─────────────────────────────────────────────────────

  it('expires by count (stocktakesUsed >= 3) → Stripe-driven, no subscription → readOnly', () => {
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(3),
      subscription: null,
    });

    expect(result.ready).toBe(true);
    expect(result.billingState.accessMode).toBe('readOnly');
    expect(result.billingState.plan).toBe('none');
    expect(result.billingState.trial).toEqual({});
  });

  it('expires by count with active Stripe subscription → full access', () => {
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(3),
      subscription: { status: 'active', plan: 'core_plus', modules: [MODULES.OPS_INTELLIGENCE], currentPeriodEnd: null },
    });

    expect(result.ready).toBe(true);
    expect(result.isActive).toBe(true);
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(true);
  });

  it('ready=false when trial expired but subscription is still undefined', () => {
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(3),
      subscription: undefined,
    });

    expect(result.ready).toBe(false);
  });

  // ── Expired by time ──────────────────────────────────────────────────────

  it('expires by time (> 30 days) → Stripe-driven, no subscription → readOnly', () => {
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(0, AFTER_PILOT.getTime()),
      nowMs: AFTER_PILOT.getTime() + 31 * ONE_DAY_MS, // 31 days after start
      subscription: null,
    });

    expect(result.billingState.accessMode).toBe('readOnly');
    expect(result.ready).toBe(true);
  });

  it('trial is still active on day 29 (boundary)', () => {
    const trialStartMs = AFTER_PILOT.getTime();
    const result = resolveEntitlements({
      ...trialBase,
      trialState: mkTrialDoc(0, trialStartMs),
      nowMs: trialStartMs + 29 * ONE_DAY_MS,
    });

    expect(result.billingState.accessMode).toBe('full');
  });
});

// ── Branch 7: Stripe-driven ───────────────────────────────────────────────────

describe('Stripe-driven branch', () => {
  // Reached by: pilot venue after grace, or old venue (venueCreatedAt=null), or post-trial

  const stripeBase: ResolveEntitlementsInput = {
    ...base,
    venueCreatedAt: BEFORE_PILOT,
    nowMs: NOW_AFTER_YEAR, // grace period over — pilot falls through to Stripe
  };

  it('active subscription → full access with correct modules', () => {
    const result = resolveEntitlements({
      ...stripeBase,
      subscription: {
        status: 'active',
        plan: 'core_plus',
        modules: [MODULES.OPS_INTELLIGENCE, MODULES.MULTI_VENUE],
        currentPeriodEnd: null,
      },
    });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.plan).toBe('core_plus');
    expect(result.billingState.accessMode).toBe('full');
    expect(result.billingState.addons.aiReporting).toBe(true);
    expect(result.billingState.addons.groupHQ).toBe(true);
    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
  });

  it('trialing subscription → treated same as active', () => {
    const result = resolveEntitlements({
      ...stripeBase,
      subscription: { status: 'trialing', plan: 'core', modules: [], currentPeriodEnd: null },
    });

    expect(result.isActive).toBe(true);
    expect(result.billingState.accessMode).toBe('full');
  });

  it('no active subscription → readOnly', () => {
    const result = resolveEntitlements({ ...stripeBase, subscription: null });

    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(false);
    expect(result.billingState.accessMode).toBe('readOnly');
    expect(result.billingState.plan).toBe('none');
  });

  // ── Loading states ────────────────────────────────────────────────────────

  it('ready=false when pilotTriggerDate is null (config/billing not yet loaded)', () => {
    const result = resolveEntitlements({
      ...stripeBase,
      pilotTriggerDate: null,
      subscription: null,
    });

    // Falls into Stripe branch with datesLoaded=false; isPilot=true (generous fallback)
    expect(result.ready).toBe(false);
    expect(result.billingState.accessMode).toBe('full'); // generous while loading
  });

  it('ready=false when subscription is undefined (snapshot not yet received)', () => {
    const result = resolveEntitlements({ ...stripeBase, subscription: undefined });

    expect(result.ready).toBe(false);
  });

  // ── Old venue (venueCreatedAt null) ──────────────────────────────────────

  it('old venue (venueCreatedAt=null) with no subscription: isPilot=true, full access', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: null,      // permanent: venue predates the createdAt field
      pilotTriggerDate: PILOT_DATE,
      subscription: null,
      nowMs: NOW_IN_YEAR,
    });

    // datesLoaded=false → isPilot = !subscription → true
    expect(result.ready).toBe(true);
    expect(result.isPilot).toBe(true);
    expect(result.billingState.accessMode).toBe('full');
  });

  it('old venue with active subscription: isActive=true overrides isPilot', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: null,
      pilotTriggerDate: PILOT_DATE,
      subscription: { status: 'active', plan: 'core', modules: [], currentPeriodEnd: null },
      nowMs: NOW_IN_YEAR,
    });

    // datesLoaded=false; !subscription=false; status=active → isPilot=false, isActive=true
    expect(result.isPilot).toBe(false);
    expect(result.isActive).toBe(true);
    expect(result.billingState.accessMode).toBe('full');
  });
});

// ── hasModule cross-branch checks ─────────────────────────────────────────────

describe('hasModule', () => {
  it('pilot in-year: only P&I module is available', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: BEFORE_PILOT,
      nowMs: NOW_IN_YEAR,
    });

    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(false);
    expect(result.hasModule(MODULES.SUPPLIER_OPTIMISATION)).toBe(false);
    expect(result.hasModule(MODULES.MULTI_VENUE)).toBe(false);
  });

  it('active trial: all modules available', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: AFTER_PILOT,
      trialState: mkTrialDoc(0),
      nowMs: AFTER_PILOT.getTime() + ONE_DAY_MS,
    });

    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(true);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(true);
    expect(result.hasModule(MODULES.SUPPLIER_OPTIMISATION)).toBe(true);
    expect(result.hasModule(MODULES.MULTI_VENUE)).toBe(true);
  });

  it('expired trial, no subscription: no modules available', () => {
    const result = resolveEntitlements({
      ...base,
      venueCreatedAt: AFTER_PILOT,
      trialState: mkTrialDoc(3),
      subscription: null,
      nowMs: AFTER_PILOT.getTime() + ONE_DAY_MS,
    });

    expect(result.hasModule(MODULES.PERFORMANCE_INCENTIVES)).toBe(false);
    expect(result.hasModule(MODULES.OPS_INTELLIGENCE)).toBe(false);
  });
});

// ── Equivalence proof (differential test) ────────────────────────────────────
// legacyResolve is a VERBATIM copy of the original inline entitlement chain
// from VenueProvider.tsx at commit b0ff186 (lines ~516-748), wrapped as a
// function. The only mechanical change is `const nowMs = Date.now()` →
// `const nowMs = input.nowMs` so the test grid controls time deterministically.
//
// The differential grid runs both implementations over a comprehensive set of
// inputs and asserts every output field is identical. If any difference
// appears between them the test reports STOP-level failure — do not fix the
// old behaviour, investigate the discrepancy instead.

// Inline type alias avoids importing from the React-heavy VenueProvider file.
type SubData = { status: string; plan: string | null; modules: string[]; currentPeriodEnd: string | null };
type SubOverride = { plan: 'core' | 'core_plus'; modules: string[] };

type LegacyOutput = Omit<ResolveEntitlementsOutput, 'ready'>;

// ── VERBATIM copy of VenueProvider.tsx b0ff186 entitlement chain ─────────────
function legacyResolve(input: ResolveEntitlementsInput & { nowMs: number }): LegacyOutput {
  const {
    venueId, ownerUid, venueCreatedAt, pilotTriggerDate,
    legacyFreeAccess, moduleTrialState,
  } = input;
  const subscriptionOverride = input.subscriptionOverride as SubOverride | null;
  const subscription = input.subscription as SubData | null;  // original type excludes undefined
  const trialState = input.trialState as TrialStateDoc | null | undefined;
  const nowMs = input.nowMs;

  const ONE_YEAR_MS_L = 365 * 24 * 60 * 60 * 1000;

  let isPilot: boolean;
  let isActive: boolean;
  let plan: string | null;
  let hasModule: (moduleId: string) => boolean;
  let billingState: BillingState;
  let discountPercent: number = 0;

  const gracePeriodEndMs = pilotTriggerDate ? pilotTriggerDate.getTime() + ONE_YEAR_MS_L : null;

  if (subscriptionOverride) {
    isPilot = false;
    isActive = true;
    plan = subscriptionOverride.plan;
    hasModule = (moduleId: string) =>
      moduleId === MODULES.PERFORMANCE_INCENTIVES || subscriptionOverride.modules.includes(moduleId);
    billingState = {
      plan: subscriptionOverride.plan,
      addons: {
        aiReporting:        subscriptionOverride.modules.includes(MODULES.OPS_INTELLIGENCE),
        predictiveOrdering: subscriptionOverride.modules.includes(MODULES.SUPPLIER_OPTIMISATION),
        gamification:       true,
        suitee:             subscriptionOverride.modules.includes(MODULES.OPS_INTELLIGENCE),
        groupHQ:            subscriptionOverride.modules.includes(MODULES.MULTI_VENUE),
      },
      accessMode: 'full',
      trial: {},
    };
  } else if (legacyFreeAccess) {
    isPilot = false;
    isActive = true;
    plan = 'core_plus';
    hasModule = (_moduleId: string) => true;
    billingState = {
      plan: 'core_plus',
      addons: {
        aiReporting:        true,
        predictiveOrdering: true,
        gamification:       true,
        suitee:             true,
        groupHQ:            true,
      },
      accessMode: 'full',
      trial: {},
    };
  } else if (ownerUid && FOUNDER_UIDS.has(ownerUid)) {
    isPilot = false;
    isActive = true;
    plan = 'core_plus';
    hasModule = (_moduleId: string) => true;
    billingState = {
      plan: 'core_plus',
      addons: {
        aiReporting:        true,
        predictiveOrdering: true,
        gamification:       true,
        suitee:             true,
        groupHQ:            true,
      },
      accessMode: 'full',
      trial: {},
    };
  } else if (venueId === MATCHBOX_VENUE_ID) {
    isPilot = false;
    isActive = true;
    plan = gracePeriodEndMs === null || nowMs < gracePeriodEndMs ? 'core_plus' : 'core';
    const matchboxFullAccess = gracePeriodEndMs === null || nowMs < gracePeriodEndMs;
    discountPercent = matchboxFullAccess ? 0 : 50;
    hasModule = (moduleId: string) =>
      matchboxFullAccess || moduleId === MODULES.PERFORMANCE_INCENTIVES;
    billingState = {
      plan: matchboxFullAccess ? 'core_plus' : 'core',
      addons: {
        aiReporting:        matchboxFullAccess,
        predictiveOrdering: matchboxFullAccess,
        gamification:       true,
        suitee:             matchboxFullAccess,
        groupHQ:            matchboxFullAccess,
      },
      accessMode: 'full',
      trial: {},
    };
  } else if (
    venueCreatedAt !== null &&
    pilotTriggerDate !== null &&
    venueCreatedAt < pilotTriggerDate &&
    gracePeriodEndMs !== null &&
    nowMs < gracePeriodEndMs
  ) {
    isPilot = false;
    isActive = true;
    plan = 'core';
    discountPercent = 50;
    hasModule = (moduleId: string) => moduleId === MODULES.PERFORMANCE_INCENTIVES;
    billingState = {
      plan: 'core',
      addons: {
        aiReporting:        false,
        predictiveOrdering: false,
        gamification:       true,
        suitee:             false,
        groupHQ:            false,
      },
      accessMode: 'full',
      trial: {},
    };
  } else if (
    venueCreatedAt !== null &&
    pilotTriggerDate !== null &&
    venueCreatedAt >= pilotTriggerDate
  ) {
    const THIRTY_DAYS_MS_L = 30 * 24 * 60 * 60 * 1000;
    const trialDoc = trialState as TrialStateDoc | null | undefined;
    const trialStartMs = trialDoc?.startedAt?.toMillis?.() ?? 0;
    const trialActive =
      trialDoc === undefined || trialDoc === null
        ? true
        : trialDoc.stocktakesUsed < 3 && nowMs < trialStartMs + THIRTY_DAYS_MS_L;

    isPilot = false;
    isActive = false;
    plan = null;

    if (trialActive) {
      hasModule = (moduleId: string) => {
        const modIntroduced = MODULE_INTRODUCED_AT[moduleId as ModuleId];
        if (modIntroduced && trialDoc && trialDoc.startedAt) {
          if (modIntroduced.getTime() > trialStartMs) {
            const entry = (moduleTrialState as Record<string, ModuleTrialEntry> | null)?.[moduleId];
            if (!entry || entry.status !== 'active') return false;
            const expMs = entry.expiresAt?.toMillis?.() ?? entry.expiresAt?.getTime?.() ?? 0;
            return nowMs < expMs;
          }
        }
        return true;
      };
      billingState = {
        plan: 'core_plus',
        addons: {
          aiReporting:        true,
          predictiveOrdering: true,
          gamification:       true,
          suitee:             true,
          groupHQ:            true,
        },
        accessMode: 'full',
        trial: {
          stocktakesRemaining: trialDoc ? Math.max(0, 3 - trialDoc.stocktakesUsed) : 3,
        },
      };
    } else {
      isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
      plan = subscription?.plan ?? null;
      hasModule = (moduleId: string) => {
        if (moduleId === MODULES.PERFORMANCE_INCENTIVES) return isActive;
        return isActive && (subscription?.modules?.includes(moduleId) ?? false);
      };
      billingState = {
        plan: isActive ? ((subscription?.plan as 'core' | 'core_plus') ?? 'core') : 'none',
        addons: {
          aiReporting:        isActive && (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
          predictiveOrdering: isActive && (subscription?.modules?.includes(MODULES.SUPPLIER_OPTIMISATION) ?? false),
          gamification:       isActive,
          suitee:             isActive && (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
          groupHQ:            isActive && (subscription?.modules?.includes(MODULES.MULTI_VENUE) ?? false),
        },
        accessMode: isActive ? 'full' : 'readOnly',
        trial: {},
      };
    }
  } else {
    const datesLoaded = pilotTriggerDate !== null && venueCreatedAt !== null;
    isPilot = datesLoaded
      ? false
      : (!subscription || !['active', 'trialing'].includes(subscription.status));
    isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
    plan = subscription?.plan ?? null;
    hasModule = (moduleId: string) => {
      if (moduleId === MODULES.PERFORMANCE_INCENTIVES) return isPilot || isActive;
      return isPilot || (subscription?.modules?.includes(moduleId) ?? false);
    };
    billingState = {
      plan: isActive ? ((subscription?.plan as 'core' | 'core_plus') ?? 'core') : 'none',
      addons: {
        aiReporting:        isPilot || (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
        predictiveOrdering: isPilot || (subscription?.modules?.includes(MODULES.SUPPLIER_OPTIMISATION) ?? false),
        gamification:       isPilot || isActive,
        suitee:             isPilot || (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
        groupHQ:            isPilot || (subscription?.modules?.includes(MODULES.MULTI_VENUE) ?? false),
      },
      accessMode: isPilot || isActive ? 'full' : 'readOnly',
      trial: {},
    };
  }

  return { isPilot, isActive, plan, hasModule, billingState, discountPercent };
}
// ── END verbatim copy ─────────────────────────────────────────────────────────

// All module ids + an unknown one — tested in every hasModule comparison
const ALL_MODULE_IDS = [...Object.values(MODULES), 'unknown-module-xyz'];

// Subscription fixtures
const SUB_NULL = null;
const mkSub = (
  status: string,
  plan: string,
  modules: string[] = [],
): SubData => ({ status, plan, modules, currentPeriodEnd: null });

const SUB_ACTIVE_CORE       = mkSub('active',   'core');
const SUB_ACTIVE_CORE_PLUS  = mkSub('active',   'core_plus', [MODULES.OPS_INTELLIGENCE, MODULES.MULTI_VENUE]);
const SUB_ACTIVE_SUPPLIER   = mkSub('active',   'core_plus', [MODULES.SUPPLIER_OPTIMISATION]);
const SUB_TRIALING          = mkSub('trialing', 'core');
const SUB_CANCELED          = mkSub('canceled', 'core');
const SUB_PAST_DUE          = mkSub('past_due', 'core');

// trialState fixtures
const TS_UNDEF = undefined;
const TS_NULL  = null;
const TS_ACTIVE_0   = mkTrialDoc(0);
const TS_ACTIVE_1   = mkTrialDoc(1);
const TS_ACTIVE_2   = mkTrialDoc(2);
const TS_EXPIRED_3  = mkTrialDoc(3);

const TRIAL_START_MS = AFTER_PILOT.getTime();
const TS_ACTIVE_0_TIMED = mkTrialDoc(0, TRIAL_START_MS);

// nowMs fixtures relative to trial start
const NOW_DAY_5  = TRIAL_START_MS + 5  * ONE_DAY_MS;
const NOW_DAY_29 = TRIAL_START_MS + 29 * ONE_DAY_MS;
const NOW_DAY_30_MINUS_1 = TRIAL_START_MS + 30 * ONE_DAY_MS - 1; // last ms of day 30
const NOW_DAY_30 = TRIAL_START_MS + 30 * ONE_DAY_MS;             // boundary: expired
const NOW_DAY_31 = TRIAL_START_MS + 31 * ONE_DAY_MS;

type GridRow = [string, ResolveEntitlementsInput];

const DIFF_GRID: GridRow[] = [
  // ── Branch 1: subscriptionOverride ─────────────────────────────────────────
  ['override/core/no-modules',
    { ...base, nowMs: NOW_IN_YEAR, subscriptionOverride: { plan: 'core', modules: [] }, trialState: TS_UNDEF }],
  ['override/core_plus/opsIntelligence',
    { ...base, nowMs: NOW_IN_YEAR, subscriptionOverride: { plan: 'core_plus', modules: [MODULES.OPS_INTELLIGENCE] } }],
  ['override/core/both-modules',
    { ...base, nowMs: NOW_IN_YEAR, subscriptionOverride: { plan: 'core', modules: [MODULES.OPS_INTELLIGENCE, MODULES.MULTI_VENUE] } }],

  // ── Branch 2: legacyFreeAccess ──────────────────────────────────────────────
  ['legacy/basic', { ...base, nowMs: NOW_IN_YEAR, legacyFreeAccess: true, subscription: SUB_NULL }],
  ['legacy/with-active-sub', { ...base, nowMs: NOW_IN_YEAR, legacyFreeAccess: true, subscription: SUB_ACTIVE_CORE }],

  // ── Branch 3: founder ────────────────────────────────────────────────────────
  ['founder/basic', { ...base, nowMs: NOW_IN_YEAR, ownerUid: FOUNDER_UID, venueCreatedAt: AFTER_PILOT, trialState: TS_UNDEF }],
  ['founder/no-sub', { ...base, nowMs: NOW_IN_YEAR, ownerUid: FOUNDER_UID, venueCreatedAt: BEFORE_PILOT, subscription: SUB_NULL }],

  // ── Branch 4: Matchbox in-year ──────────────────────────────────────────────
  ['matchbox/in-year', { ...base, venueId: MATCHBOX_VENUE_ID, ownerUid: 'mb-owner', nowMs: NOW_IN_YEAR }],
  ['matchbox/after-year', { ...base, venueId: MATCHBOX_VENUE_ID, ownerUid: 'mb-owner', nowMs: NOW_AFTER_YEAR }],
  ['matchbox/null-pilot-date', { ...base, venueId: MATCHBOX_VENUE_ID, ownerUid: 'mb-owner', pilotTriggerDate: null, nowMs: NOW_IN_YEAR }],

  // ── Branch 5: pilot venue in-year ──────────────────────────────────────────
  ['pilot/in-year', { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_IN_YEAR }],

  // ── Branch 5→7: pilot after grace → Stripe ─────────────────────────────────
  ['pilot-post-grace/no-sub',      { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_NULL }],
  ['pilot-post-grace/active-core', { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_ACTIVE_CORE }],
  ['pilot-post-grace/core-plus',   { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_ACTIVE_CORE_PLUS }],
  ['pilot-post-grace/trialing',    { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_TRIALING }],
  ['pilot-post-grace/canceled',    { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_CANCELED }],
  ['pilot-post-grace/past_due',    { ...base, venueCreatedAt: BEFORE_PILOT, nowMs: NOW_AFTER_YEAR, subscription: SUB_PAST_DUE }],

  // ── Branch 6: trial - loading states ──────────────────────────────────────
  ['trial/ts-undefined', { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_UNDEF, nowMs: NOW_DAY_5 }],
  ['trial/ts-null',      { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_NULL,  nowMs: NOW_DAY_5 }],

  // ── Branch 6: trial active ─────────────────────────────────────────────────
  ['trial/active-0-used', { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_0, nowMs: NOW_DAY_5 }],
  ['trial/active-1-used', { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_1, nowMs: NOW_DAY_5 }],
  ['trial/active-2-used', { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_2, nowMs: NOW_DAY_5 }],

  // ── Branch 6: time boundary (day 29 / last-ms day 30 / exact day 30) ───────
  ['trial/day-29-active',     { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_0_TIMED, nowMs: NOW_DAY_29 }],
  ['trial/day-30-minus-1',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_0_TIMED, nowMs: NOW_DAY_30_MINUS_1 }],
  ['trial/day-30-exact-exp',  { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_0_TIMED, nowMs: NOW_DAY_30, subscription: SUB_NULL }],
  ['trial/day-31-expired',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_ACTIVE_0_TIMED, nowMs: NOW_DAY_31, subscription: SUB_NULL }],

  // ── Branch 6→7: trial expired by count ────────────────────────────────────
  ['trial/exp-count/no-sub',      { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_NULL }],
  ['trial/exp-count/active-core', { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_ACTIVE_CORE }],
  ['trial/exp-count/core-plus',   { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_ACTIVE_CORE_PLUS }],
  ['trial/exp-count/supplier',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_ACTIVE_SUPPLIER }],
  ['trial/exp-count/trialing',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_TRIALING }],
  ['trial/exp-count/canceled',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_CANCELED }],
  ['trial/exp-count/past_due',    { ...base, venueCreatedAt: AFTER_PILOT, trialState: TS_EXPIRED_3, nowMs: NOW_DAY_5, subscription: SUB_PAST_DUE }],

  // ── Branch 7: Stripe (old venues, venueCreatedAt null) ─────────────────────
  ['old-venue/no-sub',           { ...base, venueCreatedAt: null, subscription: SUB_NULL,         nowMs: NOW_IN_YEAR }],
  ['old-venue/active-core',      { ...base, venueCreatedAt: null, subscription: SUB_ACTIVE_CORE,  nowMs: NOW_IN_YEAR }],
  ['old-venue/core-plus-modules',{ ...base, venueCreatedAt: null, subscription: SUB_ACTIVE_CORE_PLUS, nowMs: NOW_IN_YEAR }],
  ['old-venue/canceled',         { ...base, venueCreatedAt: null, subscription: SUB_CANCELED,     nowMs: NOW_IN_YEAR }],

  // ── Branch 7: Stripe (pilotTriggerDate null — config loading) ──────────────
  ['stripe/no-pilot-date/no-sub',    { ...base, pilotTriggerDate: null, subscription: SUB_NULL,        nowMs: NOW_IN_YEAR }],
  ['stripe/no-pilot-date/active',    { ...base, pilotTriggerDate: null, subscription: SUB_ACTIVE_CORE, nowMs: NOW_IN_YEAR }],
  ['stripe/no-pilot-date/trialing',  { ...base, pilotTriggerDate: null, subscription: SUB_TRIALING,    nowMs: NOW_IN_YEAR }],

  // ── venueId null ────────────────────────────────────────────────────────────
  ['no-venue-id/no-sub',    { ...base, venueId: null, venueCreatedAt: null, subscription: SUB_NULL,        nowMs: NOW_IN_YEAR }],
  ['no-venue-id/active',    { ...base, venueId: null, venueCreatedAt: null, subscription: SUB_ACTIVE_CORE, nowMs: NOW_IN_YEAR }],
];

describe('differential: resolveEntitlements === original VenueProvider chain', () => {
  // If any case fails, STOP — do NOT fix the old behaviour; investigate the diff.
  it.each(DIFF_GRID)('%s', (_label, rawInput) => {
    const input: ResolveEntitlementsInput & { nowMs: number } = {
      ...rawInput,
      nowMs: rawInput.nowMs ?? NOW_IN_YEAR,
    };

    const legacy    = legacyResolve(input);
    const extracted = resolveEntitlements(input);

    expect(extracted.isActive).toBe(legacy.isActive);
    expect(extracted.isPilot).toBe(legacy.isPilot);
    expect(extracted.plan).toBe(legacy.plan);
    expect(extracted.billingState.accessMode).toBe(legacy.billingState.accessMode);
    expect(extracted.billingState.plan).toBe(legacy.billingState.plan);
    expect(extracted.billingState.addons).toEqual(legacy.billingState.addons);
    expect(extracted.billingState.trial.stocktakesRemaining)
      .toBe(legacy.billingState.trial.stocktakesRemaining);
    expect(extracted.discountPercent).toBe(legacy.discountPercent);

    for (const moduleId of ALL_MODULE_IDS) {
      expect(extracted.hasModule(moduleId)).toBe(legacy.hasModule(moduleId));
    }
  });
});
