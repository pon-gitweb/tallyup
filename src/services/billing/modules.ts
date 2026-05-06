// Canonical module IDs — stored in venues/{venueId}.subscription.modules[]
// Single source of truth for all three previous inconsistent lists.
export const MODULES = {
  SUPPLIER_OPTIMISATION: 'supplier_optimisation',
  OPS_INTELLIGENCE: 'ops_intelligence',
  PERFORMANCE_INCENTIVES: 'performance_incentives',
  MULTI_VENUE: 'multi_venue',
} as const;

export type ModuleId = typeof MODULES[keyof typeof MODULES];
