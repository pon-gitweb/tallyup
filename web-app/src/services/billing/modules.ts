// Canonical module IDs — stored in venues/{venueId}.subscription.modules[]
// Port of src/services/billing/modules.ts (mobile). Values must stay in sync.
// Separate build targets — do not import from src/ or functions/.
export const MODULES = {
  SUPPLIER_OPTIMISATION: 'supplier_optimisation',
  OPS_INTELLIGENCE: 'ops_intelligence',
  PERFORMANCE_INCENTIVES: 'performance_incentives',
  MULTI_VENUE: 'multi_venue',
} as const;

export type ModuleId = typeof MODULES[keyof typeof MODULES];
