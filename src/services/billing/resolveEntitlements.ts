import { BillingState } from './entitlements';
import { MODULES, MODULE_INTRODUCED_AT, ModuleId } from './modules';
import { SubscriptionData, SubscriptionOverride } from '../../context/VenueProvider';

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors the private shapes in VenueProvider; defined here so the pure
// function can be used and tested without importing React context.

export type TrialStateDoc = {
  startedAt: { toMillis: () => number } | null;
  stocktakesAtStart: number;
  stocktakesUsed: number;
  status: 'active' | 'converting' | 'expired';
  resolvedAt?: unknown;
  resolvedReason?: string;
  reminderSentAt?: unknown;
};

export type ModuleTrialEntry = {
  startedAt: unknown;
  expiresAt: { toMillis?: () => number; getTime?: () => number } | null;
  status: 'active' | 'expired' | 'converted';
};

// ── Constants ─────────────────────────────────────────────────────────────────
// Duplicated from VenueProvider so this module has no React import.

export const FOUNDER_UIDS = new Set([
  'ChpWVbutHwSCRQKr3THR79EIw1X2', // Poni (account 1)
  'nIIcWSEbb2QjkKlwrALBUFXIXtu2', // Poni (account 2)
  'DyydVaTSaPN5MWrLyHczVeZbzDv2', // Izzy (account 1)
  'XdxYqrCUeQYvfHkJkptjOoXDEwl2', // Chris (account 1)
  'OIvPVgL6FpN960FMqTybe7aMRZG3', // Chris (account 2)
  'WXQtR9QUsCShHtmKzopGEwiQYLV2', // Shayle (account 1)
]);

export const MATCHBOX_VENUE_ID = 'O9pChydjz75nwpWA81KO';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Input / Output types ───────────────────────────────────────────────────────

export interface ResolveEntitlementsInput {
  venueId: string | null;
  ownerUid: string | null;
  venueCreatedAt: Date | null;
  /** null = config/billing doc not yet loaded */
  pilotTriggerDate: Date | null;
  legacyFreeAccess: boolean;
  subscriptionOverride: SubscriptionOverride | null;
  /** undefined = Firestore snapshot not yet received; null = loaded, no subscription */
  subscription: SubscriptionData | null | undefined;
  /** undefined = Firestore snapshot not yet received; null = doc absent (pending server trigger) */
  trialState: TrialStateDoc | null | undefined;
  moduleTrialState: Record<string, ModuleTrialEntry> | null;
  /** Overridable for deterministic tests; defaults to Date.now() */
  nowMs?: number;
}

export interface ResolveEntitlementsOutput {
  isPilot: boolean;
  isActive: boolean;
  plan: string | null;
  hasModule: (moduleId: string) => boolean;
  billingState: BillingState;
  discountPercent: number;
  /** false while any input needed for a confident entitlement decision is still loading */
  ready: boolean;
}

// ── Pure function ─────────────────────────────────────────────────────────────
// Mirrors the entitlement chain in VenueProvider exactly, with no side-effects.
// Priority order matches VenueProvider:
//   1. subscriptionOverride
//   2. legacyFreeAccess
//   3. Founder UID
//   4. Matchbox venue
//   5. Pilot venue (in-year)
//   6. D-039 trial (venueCreatedAt >= pilotTriggerDate)
//   7. Stripe-driven (all other cases)

export function resolveEntitlements({
  venueId,
  ownerUid,
  venueCreatedAt,
  pilotTriggerDate,
  legacyFreeAccess,
  subscriptionOverride,
  subscription,
  trialState,
  moduleTrialState,
  nowMs: nowMsInput,
}: ResolveEntitlementsInput): ResolveEntitlementsOutput {
  const nowMs = nowMsInput ?? Date.now();
  const gracePeriodEndMs = pilotTriggerDate ? pilotTriggerDate.getTime() + ONE_YEAR_MS : null;

  let isPilot: boolean;
  let isActive: boolean;
  let plan: string | null;
  let hasModule: (moduleId: string) => boolean;
  let billingState: BillingState;
  let discountPercent = 0;
  let ready: boolean;

  if (subscriptionOverride) {
    isPilot = false;
    isActive = true;
    plan = subscriptionOverride.plan;
    hasModule = (moduleId: string) =>
      moduleId === MODULES.PERFORMANCE_INCENTIVES ||
      subscriptionOverride.modules.includes(moduleId);
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
    ready = true;

  } else if (legacyFreeAccess) {
    isPilot = false;
    isActive = true;
    plan = 'core_plus';
    hasModule = () => true;
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
    ready = true;

  } else if (ownerUid && FOUNDER_UIDS.has(ownerUid)) {
    isPilot = false;
    isActive = true;
    plan = 'core_plus';
    hasModule = () => true;
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
    ready = true;

  } else if (venueId === MATCHBOX_VENUE_ID) {
    const matchboxFullAccess = gracePeriodEndMs === null || nowMs < gracePeriodEndMs;
    isPilot = false;
    isActive = true;
    plan = matchboxFullAccess ? 'core_plus' : 'core';
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
    ready = true;

  } else if (
    venueCreatedAt !== null &&
    pilotTriggerDate !== null &&
    venueCreatedAt < pilotTriggerDate &&
    gracePeriodEndMs !== null &&
    nowMs < gracePeriodEndMs
  ) {
    // Pilot venue (in-year): created before pilotTriggerDate, still within grace period
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
    ready = true;

  } else if (
    venueCreatedAt !== null &&
    pilotTriggerDate !== null &&
    venueCreatedAt >= pilotTriggerDate
  ) {
    // D-039 trial branch
    const trialDoc = trialState as TrialStateDoc | null | undefined;
    const trialStartMs = trialDoc?.startedAt?.toMillis?.() ?? 0;
    const trialActive =
      trialDoc === undefined || trialDoc === null
        ? true
        : trialDoc.stocktakesUsed < 3 && nowMs < trialStartMs + THIRTY_DAYS_MS;

    isPilot = false;
    isActive = false;
    plan = null;

    if (trialActive) {
      hasModule = (moduleId: string) => {
        const modIntroduced = MODULE_INTRODUCED_AT[moduleId as ModuleId];
        if (modIntroduced && trialDoc && trialDoc.startedAt) {
          if (modIntroduced.getTime() > trialStartMs) {
            const entry = moduleTrialState?.[moduleId];
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
      // undefined = snapshot not yet received (loading); null = doc absent, pending server trigger (loaded)
      ready = trialState !== undefined;

    } else {
      // Trial exhausted — Stripe-driven from here
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
      ready = subscription !== undefined;
    }

  } else {
    // Stripe-driven branch (all other cases, including loading-fallback when dates not resolved)
    const datesLoaded = pilotTriggerDate !== null && venueCreatedAt !== null;
    isPilot = datesLoaded
      ? false
      : (!subscription || !['active', 'trialing'].includes(subscription?.status ?? ''));
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
    // ready: false if pilotTriggerDate hasn't loaded yet (can't confirm which branch this venue belongs in)
    // ready: true once pilotTriggerDate + subscription are resolved, even if venueCreatedAt is null (old venue)
    ready = pilotTriggerDate !== null && subscription !== undefined;
  }

  return { isPilot, isActive, plan, hasModule, billingState, discountPercent, ready };
}
