/**
 * Pure helpers for Suggested Orders & Orders planning.
 * Keep these framework-agnostic so Jest can run them fast.
 */

/** Abbreviate a supplier name to 3 chars (fallback to id) */
export function abbr3(name?: string | null, fallback?: string): string {
  const s = (name || '').trim();
  if (s.length >= 3) return s.slice(0, 3).toUpperCase();
  const f = (fallback || '').trim();
  if (f.length >= 3) return f.slice(0, 3).toUpperCase();
  return (s || f || 'SUP').toUpperCase();
}

/** Extract supplier id/name from a product doc with many legacy shapes */
export function extractSupplierFromProductDoc(pd: any): { supplierId?: string | null; supplierName?: string | null } {
  if (!pd) return {};
  const sid =
    pd.supplierId ??
    pd.supplierRefId ??
    (pd.supplier && (pd.supplier.id || pd.supplier.uid)) ??
    pd.vendorId ??
    (pd.vendor && (pd.vendor.id || pd.vendor.uid)) ??
    (pd.supplierRef && pd.supplierRef.id) ??
    (pd.vendorRef && pd.vendorRef.id) ??
    null;

  const sname =
    pd.supplierName ??
    (pd.supplier && pd.supplier.name) ??
    (pd.vendor && pd.vendor.name) ??
    null;

  return { supplierId: sid ?? null, supplierName: sname ?? null };
}

/**
 * Build a plan for “Create Drafts (All)”.
 * Input:
 *  - perSupplier: Map<supplierId, { supplierName, lines }> from Suggestions
 *  - existingDraftBySupplier: Record<supplierId, true> (for current cycle)
 * Output:
 *  - { willCreate: [...], willMerge: [...] }
 */
export function buildAllDraftPlan(
  perSupplier: Map<string, { supplierName: string; lines: Array<{ productId?: string; qty?: number }> }>,
  existingDraftBySupplier: Record<string, true>
): {
  willCreate: Array<{ supplierId: string; supplierName: string; count: number }>;
  willMerge: Array<{ supplierId: string; supplierName: string; count: number }>;
} {
  const willCreate: Array<{ supplierId: string; supplierName: string; count: number }> = [];
  const willMerge: Array<{ supplierId: string; supplierName: string; count: number }> = [];

  for (const [sid, { supplierName, lines }] of perSupplier.entries()) {
    const count = (lines || []).filter(l => l?.productId && Number(l?.qty) > 0).length;
    if (count === 0) continue;
    if (existingDraftBySupplier[sid]) willMerge.push({ supplierId: sid, supplierName, count });
    else willCreate.push({ supplierId: sid, supplierName, count });
  }

  // stable sort for predictable messaging
  const byName = (a: any, b: any) => (a.supplierName || '').localeCompare(b.supplierName || '');
  willCreate.sort(byName);
  willMerge.sort(byName);

  return { willCreate, willMerge };
}
