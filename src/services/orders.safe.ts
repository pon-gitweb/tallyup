// @ts-nocheck
export type OrderLine = {
  productId: string;
  qty: number;
  name?: string;
  unitCost?: number;
  packSize?: number | null;
};

// If you already have a real implementation elsewhere, prefer that.
// This is only a typing shim to keep callers compiling.
export async function createDraftOrderWithLines(
  venueId: string,
  supplierId: string,
  lines: OrderLine[],
  notes?: string | null
) {
  // no-op shim used only for typing in places that import this helper.
  // Real creation logic lives in SuggestedOrderScreen and order services.
  return { id: null, supplierId, count: Array.isArray(lines) ? lines.length : 0, notes: notes ?? null };
}
