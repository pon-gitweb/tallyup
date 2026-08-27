/**
 * Human-readable label for the quantityConfidence field used in stock-holding exports.
 *
 * 'physical_count'       → Confirmed
 * 'estimated_with_sales' → Estimated (with sales data)
 * 'estimated_no_sales'   → Estimated (no sales data)
 * absent / undefined     → Estimated (no sales data)   ← same as least-confident tier,
 *                                                         matching the on-screen rule that
 *                                                         "no information" is treated
 *                                                         identically to unconfirmed.
 *
 * Used in PDF and CSV exports only. The on-screen ~ marker uses the raw
 * !== 'physical_count' check directly — do not change that logic here.
 */
export function fmtQuantityConfidence(qc?: string): string {
  if (qc === 'physical_count') return 'Confirmed';
  if (qc === 'estimated_with_sales') return 'Estimated (with sales data)';
  // 'estimated_no_sales' or absent/undefined → least-confident tier label.
  return 'Estimated (no sales data)';
}
