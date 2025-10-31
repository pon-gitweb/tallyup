// Central place for the SuggestedLine shape used by orders flows.

export type SuggestedLine = {
  productId: string;
  productName: string;

  // supplier linkage (optional when unassigned)
  supplierId?: string | null;
  supplierName?: string | null;

  // quantities & price info
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;

  // optional metadata/flags from the suggester
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;

  // department scoping (optional)
  departmentId?: string | null;
};

// --- additive: legacy alias for callers expecting a map of arrays ---
export type SuggestedLegacyMap = Record<string, SuggestedLine[]>;
