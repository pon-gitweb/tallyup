// Canonical module IDs — stored in venues/{venueId}.subscription.modules[]
// Single source of truth for all three previous inconsistent lists.
export const MODULES = {
  SUPPLIER_OPTIMISATION: 'supplier_optimisation',
  OPS_INTELLIGENCE: 'ops_intelligence',
  PERFORMANCE_INCENTIVES: 'performance_incentives',
  MULTI_VENUE: 'multi_venue',
} as const;

export type ModuleId = typeof MODULES[keyof typeof MODULES];

// Catalog-introduction date per module. Used by D-039 trial logic: a module
// introduced AFTER a venue's trialState.startedAt gets its own 14-day trial
// on first encounter, rather than being bundled into the venue's main trial.
// All modules that existed before D-039 launched (2026-09-27) are backdated
// so no current module triggers the new-module path.
export const MODULE_INTRODUCED_AT: Record<ModuleId, Date> = {
  supplier_optimisation:  new Date('2024-01-01'),
  ops_intelligence:       new Date('2024-01-01'),
  performance_incentives: new Date('2024-01-01'),
  multi_venue:            new Date('2024-01-01'),
};
