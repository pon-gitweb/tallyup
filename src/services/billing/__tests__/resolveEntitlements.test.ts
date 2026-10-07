import {
  resolveEntitlements,
  MATCHBOX_VENUE_ID,
  FOUNDER_UIDS,
  type ResolveEntitlementsInput,
  type TrialStateDoc,
} from '../resolveEntitlements';
import { MODULES } from '../modules';

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
