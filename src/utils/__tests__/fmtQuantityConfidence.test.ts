// Tests for fmtQuantityConfidence — the plain-English label used in stock-holding exports.
//
// On-screen marker logic (~ prefix, !== 'physical_count' check) is separate and
// tested in src/services/products/__tests__/resolveProduct.test.ts — this file
// covers the export-label mapping only.

import { fmtQuantityConfidence } from '../fmtQuantityConfidence';

describe('fmtQuantityConfidence — export label mapping', () => {
  it("'physical_count' → 'Confirmed'", () => {
    expect(fmtQuantityConfidence('physical_count')).toBe('Confirmed');
  });

  it("'estimated_with_sales' → 'Estimated (with sales data)'", () => {
    expect(fmtQuantityConfidence('estimated_with_sales')).toBe('Estimated (with sales data)');
  });

  it("'estimated_no_sales' → 'Estimated (no sales data)'", () => {
    expect(fmtQuantityConfidence('estimated_no_sales')).toBe('Estimated (no sales data)');
  });

  it('absent / undefined → same label as estimated_no_sales (no-information = least-confident tier)', () => {
    expect(fmtQuantityConfidence(undefined)).toBe('Estimated (no sales data)');
  });

  // Confirm the on-screen marker predicate is unaffected by this change:
  // the marker checks !== 'physical_count' directly on the raw field, not the label.
  it('on-screen marker predicate still fires for all non-confirmed values', () => {
    const needsMarker = (qc?: string) => qc !== 'physical_count';
    expect(needsMarker('physical_count')).toBe(false);
    expect(needsMarker('estimated_with_sales')).toBe(true);
    expect(needsMarker('estimated_no_sales')).toBe(true);
    expect(needsMarker(undefined)).toBe(true);
  });
});
