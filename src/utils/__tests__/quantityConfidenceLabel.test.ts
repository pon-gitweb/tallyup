// Tests for quantityConfidenceCaption — the tooltip/caption copy for the
// cost-price field when quantity confidence is not 'physical_count'.
//
// Coverage:
//   - physical_count → null (no caption shown on either platform)
//   - estimated_with_sales + date → Q2 copy with distinct "using sales data" phrasing
//   - estimated_no_sales + date   → Q3 copy with distinct "without sales data" phrasing
//   - absent quantityConfidence   → Q3 copy (treat absence as least-confident tier)
//   - absent costPriceBasisAt     → fallback "no confirmed count" copy (no broken date string)
//   - isEstimate priority (web):  catalogue_estimate tooltip wins when both flags are true

import { quantityConfidenceCaption, fmtBasisDate } from '../quantityConfidenceLabel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Firestore-style Timestamp stub with a known date
const mockTimestamp = { toDate: () => new Date('2026-01-15T00:00:00.000Z') };

// ── fmtBasisDate ──────────────────────────────────────────────────────────────

describe('fmtBasisDate', () => {
  it('returns null for null / undefined', () => {
    expect(fmtBasisDate(null)).toBeNull();
    expect(fmtBasisDate(undefined)).toBeNull();
  });

  it('formats a Firestore Timestamp-like object', () => {
    const result = fmtBasisDate(mockTimestamp);
    // en-NZ locale: "15 Jan 2026"
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2026/);
  });

  it('returns null for invalid date inputs without throwing', () => {
    expect(fmtBasisDate('not-a-date')).toBeNull();
    expect(fmtBasisDate({})).toBeNull();
  });
});

// ── quantityConfidenceCaption ─────────────────────────────────────────────────

describe('quantityConfidenceCaption', () => {
  // 1. physical_count → null (no caption shown)
  it('physical_count → null regardless of date', () => {
    expect(quantityConfidenceCaption('physical_count', mockTimestamp)).toBeNull();
    expect(quantityConfidenceCaption('physical_count', null)).toBeNull();
    expect(quantityConfidenceCaption('physical_count', undefined)).toBeNull();
  });

  // 2. estimated_with_sales + date → Q2 copy, distinct from Q3
  it('estimated_with_sales + date → Q2 copy containing "using sales data"', () => {
    const result = quantityConfidenceCaption('estimated_with_sales', mockTimestamp);
    expect(result).not.toBeNull();
    expect(result).toContain('using sales data');
    // Must include the formatted date
    expect(result).toMatch(/Jan 2026/);
  });

  // 3. estimated_no_sales + date → Q3 copy, distinct from Q2
  it('estimated_no_sales + date → Q3 copy containing "without sales data"', () => {
    const result = quantityConfidenceCaption('estimated_no_sales', mockTimestamp);
    expect(result).not.toBeNull();
    expect(result).toContain('without sales data');
    expect(result).not.toContain('using sales data');
  });

  // 4. Absent quantityConfidence + date → Q3 copy (no-information = lowest tier)
  it('absent quantityConfidence + date → Q3 copy (same as estimated_no_sales)', () => {
    const withNull = quantityConfidenceCaption(null, mockTimestamp);
    const withUndef = quantityConfidenceCaption(undefined, mockTimestamp);
    expect(withNull).toContain('without sales data');
    expect(withUndef).toContain('without sales data');
  });

  // 5. Absent costPriceBasisAt → fallback, never a broken date string
  it('absent costPriceBasisAt → "No confirmed count on file yet" fallback', () => {
    const result = quantityConfidenceCaption('estimated_with_sales', null);
    expect(result).not.toBeNull();
    expect(result).toContain('No confirmed count on file yet');
    // Must NOT contain any broken date fragment
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('Invalid');
  });

  it('absent costPriceBasisAt → fallback for all non-physical tiers', () => {
    expect(quantityConfidenceCaption('estimated_no_sales', undefined))
      .toContain('No confirmed count on file yet');
    expect(quantityConfidenceCaption(undefined, undefined))
      .toContain('No confirmed count on file yet');
  });

  // 6. isEstimate priority (web): catalogue_estimate wins over quantityConfidence
  //    This simulates the component logic: isEstimate checked first, isLowConfidence
  //    only applied when !isEstimate.
  it('isEstimate priority: catalogue_estimate tooltip wins when both flags are true', () => {
    function webCellTitle(product: {
      costPriceSource?: string | null;
      quantityConfidence?: string | null;
      costPriceBasisAt?: any;
    }): string | null {
      const isEstimate = product.costPriceSource === 'catalogue_estimate';
      if (isEstimate) return 'Estimated from catalogue, not yet confirmed by invoice';
      return quantityConfidenceCaption(product.quantityConfidence, product.costPriceBasisAt);
    }

    const product = {
      costPriceSource: 'catalogue_estimate',
      quantityConfidence: 'estimated_with_sales',
      costPriceBasisAt: mockTimestamp,
    };
    const title = webCellTitle(product);
    expect(title).toBe('Estimated from catalogue, not yet confirmed by invoice');
    // quantityConfidence copy must NOT appear
    expect(title).not.toContain('sales data');
  });

  it('isEstimate false → quantityConfidence copy is shown instead', () => {
    function webCellTitle(product: {
      costPriceSource?: string | null;
      quantityConfidence?: string | null;
      costPriceBasisAt?: any;
    }): string | null {
      const isEstimate = product.costPriceSource === 'catalogue_estimate';
      if (isEstimate) return 'Estimated from catalogue, not yet confirmed by invoice';
      return quantityConfidenceCaption(product.quantityConfidence, product.costPriceBasisAt);
    }

    const product = {
      costPriceSource: null,
      quantityConfidence: 'estimated_with_sales',
      costPriceBasisAt: mockTimestamp,
    };
    const title = webCellTitle(product);
    expect(title).toContain('using sales data');
    expect(title).not.toContain('catalogue');
  });
});
