/**
 * priceChangeSanity.ts
 *
 * Shared utility for detecting and reporting anomalously large price-change
 * percentages before they distort an average.
 *
 * Single source of truth for the threshold so call sites don't each hardcode
 * a magic number.
 */

export const ANOMALOUS_CHANGE_THRESHOLD_PCT = 75;

export interface SanityInput {
  value: number;
  label: string;
}

export interface SanityResult {
  /** Mean of all values (no exclusions). */
  rawAverage: number;
  /** Mean of values where |value| <= threshold; equals rawAverage when nothing is flagged. */
  cleanAverage: number;
  /** Values where |value| > threshold — excluded from cleanAverage. */
  flagged: SanityInput[];
}

/**
 * Splits a set of change-percent values into normal and anomalous, returning
 * both the raw average (all values) and the clean average (anomalies excluded).
 *
 * Rounding: Math.round(x * 100) / 100 — matches the existing convention in
 * aggregateSupplierTrend and the api.ts context builder.
 *
 * Edge cases:
 *   - Empty input: all averages 0, flagged empty.
 *   - All values flagged: cleanAverage falls back to rawAverage (no clean
 *     values to average, so the raw is the best available).
 */
export function flagAnomalousChanges(
  changePercents: SanityInput[],
  threshold = ANOMALOUS_CHANGE_THRESHOLD_PCT,
): SanityResult {
  if (changePercents.length === 0) {
    return { rawAverage: 0, cleanAverage: 0, flagged: [] };
  }

  const rawSum = changePercents.reduce((s, c) => s + c.value, 0);
  const rawAverage = Math.round((rawSum / changePercents.length) * 100) / 100;

  const flagged = changePercents.filter(c => Math.abs(c.value) > threshold);
  const clean   = changePercents.filter(c => Math.abs(c.value) <= threshold);

  const cleanAverage = clean.length > 0
    ? Math.round((clean.reduce((s, c) => s + c.value, 0) / clean.length) * 100) / 100
    : rawAverage;

  return { rawAverage, cleanAverage, flagged };
}
