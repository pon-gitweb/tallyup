/**
 * Pure utility for quantity-confidence tooltips and captions.
 * No React or Firebase imports — safe to unit-test anywhere.
 */

/** Format a Firestore Timestamp or Date-like value as a readable date string. */
export function fmtBasisDate(ts: any): string | null {
  if (ts == null) return null;
  try {
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
}

/**
 * Caption / tooltip text for the cost-price field when quantity confidence
 * is not 'physical_count'. Returns null when no caption should be shown.
 *
 * Copy selection:
 *   physical_count                       → null (no caption)
 *   estimated_with_sales + date present  → Q2 copy with date
 *   estimated_no_sales / absent + date   → Q3 copy with date
 *   Any tier, date absent                → fallback "No confirmed count on file yet…"
 */
export function quantityConfidenceCaption(
  qc?: string | null,
  costPriceBasisAt?: any,
): string | null {
  if (qc === 'physical_count') return null;
  const date = fmtBasisDate(costPriceBasisAt);
  if (!date) return 'No confirmed count on file yet — quantity basis is an early estimate.';
  if (qc === 'estimated_with_sales') {
    return `Quantity basis last estimated using sales data (as of ${date}). Run a stocktake to confirm.`;
  }
  return `Quantity basis last estimated without sales data (as of ${date}). Run a stocktake to confirm.`;
}
