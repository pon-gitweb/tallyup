export type AccessMode = 'full' | 'readOnly';

export type Addons = {
  aiReporting?: boolean;
  predictiveOrdering?: boolean;
  gamification?: boolean;
  suitee?: boolean;
  groupHQ?: boolean;
};

export interface TrialCounters {
  stocktakesRemaining?: number;         // e.g., 3
  aiReportsRemaining?: number;          // e.g., 3
  predictiveCartsRemaining?: number;    // e.g., 2
  suiteeFlowsRemaining?: number;        // e.g., 1
}

export interface BillingState {
  plan: 'core' | 'core_plus' | 'none';
  addons: Addons;
  accessMode: AccessMode;
  trial: TrialCounters;
  // Optional meta for UI
  lastPaymentStatus?: 'ok' | 'failed' | 'past_due';
  nextAction?: 'resubscribe' | 'none';
}

export const defaultBillingState: BillingState = {
  plan: 'none',
  addons: {},
  accessMode: 'readOnly',
  trial: {
    stocktakesRemaining: 3,
    aiReportsRemaining: 3,
    predictiveCartsRemaining: 2,
    suiteeFlowsRemaining: 1,
  },
  lastPaymentStatus: 'ok',
  nextAction: 'none',
};

// Business rules (client-side helpers; persist server-side truth in Firestore)
export function canPerformStocktake(b: BillingState): boolean {
  if (b.accessMode === 'full') return true;
  // readOnly: allow if trial remains
  return (b.trial.stocktakesRemaining ?? 0) > 0;
}

export function consumeStocktakeTrial(b: BillingState): BillingState {
  const left = Math.max(0, (b.trial.stocktakesRemaining ?? 0) - 1);
  return { ...b, trial: { ...b.trial, stocktakesRemaining: left } };
}

export function isReadOnly(b: BillingState): boolean {
  return b.accessMode === 'readOnly';
}

// Generic helper
export function decrementCounter(b: BillingState, key: keyof TrialCounters): BillingState {
  const curr = b.trial[key] ?? 0;
  const next = Math.max(0, curr - 1);
  return { ...b, trial: { ...b.trial, [key]: next } };
}

// --- Lightweight helpers for trial-aware guards ---
export function getTrialsLeft(b: BillingState, key: keyof TrialCounters): number {
  return Math.max(0, Number(b.trial[key] ?? 0));
}

export function canUseTrial(b: BillingState, key: keyof TrialCounters): boolean {
  return getTrialsLeft(b, key) > 0;
}

// Optional: tiny action→trial key map for reuse in screens
export const TrialKeyMap = {
  stocktake: 'stocktakesRemaining',
  aiReport: 'aiReportsRemaining',
  predictiveCart: 'predictiveCartsRemaining',
  suiteeFlow: 'suiteeFlowsRemaining',
} as const;

export type TrialAction = keyof typeof TrialKeyMap;
