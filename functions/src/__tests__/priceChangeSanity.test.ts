/**
 * Tests for flagAnomalousChanges (priceChangeSanity.ts).
 *
 * Covers:
 *  - No outliers: rawAverage === cleanAverage, flagged empty
 *  - One extreme outlier correctly excluded from cleanAverage, included in rawAverage
 *  - Multiple flagged values all excluded from cleanAverage
 *  - Both suiteeTools.ts and api.ts import from priceChangeSanity (import-presence check)
 *  - api.ts velocityHistory averaging (~line 5590) is untouched (plain average, no utility)
 */

import * as fs from 'fs';
import * as path from 'path';
import { flagAnomalousChanges, ANOMALOUS_CHANGE_THRESHOLD_PCT } from '../priceChangeSanity';

const SRC = path.join(__dirname, '..');

// ── Unit tests: flagAnomalousChanges ──────────────────────────────────────────

describe('flagAnomalousChanges — no outliers', () => {
  it('returns rawAverage === cleanAverage and empty flagged when all values are within threshold', () => {
    const input = [
      { value: 5,  label: 'Product A' },
      { value: 10, label: 'Product B' },
      { value: -3, label: 'Product C' },
    ];
    const result = flagAnomalousChanges(input);
    expect(result.flagged).toHaveLength(0);
    expect(result.rawAverage).toBe(result.cleanAverage);
    expect(result.rawAverage).toBe(Math.round(((5 + 10 + -3) / 3) * 100) / 100);
  });

  it('value exactly at threshold is not flagged', () => {
    const input = [{ value: ANOMALOUS_CHANGE_THRESHOLD_PCT, label: 'Edge' }];
    const result = flagAnomalousChanges(input);
    expect(result.flagged).toHaveLength(0);
    expect(result.cleanAverage).toBe(ANOMALOUS_CHANGE_THRESHOLD_PCT);
  });

  it('empty input returns all zeros and empty flagged', () => {
    const result = flagAnomalousChanges([]);
    expect(result.rawAverage).toBe(0);
    expect(result.cleanAverage).toBe(0);
    expect(result.flagged).toHaveLength(0);
  });
});

describe('flagAnomalousChanges — one extreme outlier', () => {
  it('239% outlier is excluded from cleanAverage and included in rawAverage', () => {
    const input = [
      { value: 5,   label: 'Normal Product' },
      { value: 8,   label: 'Another Product' },
      { value: 239, label: 'Vinegar White 5L' },
    ];
    const result = flagAnomalousChanges(input);

    // rawAverage includes all three
    const expectedRaw = Math.round(((5 + 8 + 239) / 3) * 100) / 100;
    expect(result.rawAverage).toBe(expectedRaw); // ~84

    // cleanAverage uses only 5 and 8
    const expectedClean = Math.round(((5 + 8) / 2) * 100) / 100; // 6.5
    expect(result.cleanAverage).toBe(expectedClean);
    expect(result.cleanAverage).not.toBe(result.rawAverage);

    // flagged contains exactly the outlier
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].label).toBe('Vinegar White 5L');
    expect(result.flagged[0].value).toBe(239);
  });

  it('negative outlier (−239%) is also flagged', () => {
    const input = [
      { value: -239, label: 'Price Crash' },
      { value: 10,   label: 'Normal A' },
    ];
    const result = flagAnomalousChanges(input);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].label).toBe('Price Crash');
    expect(result.cleanAverage).toBe(10);
  });
});

describe('flagAnomalousChanges — multiple outliers', () => {
  it('all outliers excluded from cleanAverage and all appear in flagged', () => {
    const input = [
      { value: 3,   label: 'Normal'   },
      { value: 100, label: 'Outlier1' },
      { value: 200, label: 'Outlier2' },
      { value: 7,   label: 'Normal2'  },
    ];
    const result = flagAnomalousChanges(input);

    expect(result.flagged).toHaveLength(2);
    const flaggedLabels = result.flagged.map(f => f.label).sort();
    expect(flaggedLabels).toEqual(['Outlier1', 'Outlier2']);

    // cleanAverage = (3 + 7) / 2 = 5
    expect(result.cleanAverage).toBe(5);

    // rawAverage = (3 + 100 + 200 + 7) / 4 = 77.5
    expect(result.rawAverage).toBe(77.5);
  });

  it('when all values are flagged, cleanAverage falls back to rawAverage', () => {
    const input = [
      { value: 100, label: 'A' },
      { value: 200, label: 'B' },
    ];
    const result = flagAnomalousChanges(input);
    expect(result.flagged).toHaveLength(2);
    expect(result.cleanAverage).toBe(result.rawAverage);
  });
});

describe('flagAnomalousChanges — custom threshold', () => {
  it('respects a custom threshold argument', () => {
    const input = [
      { value: 60, label: 'Just above 50' },
      { value: 30, label: 'Below 50'      },
    ];
    const result = flagAnomalousChanges(input, 50);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].label).toBe('Just above 50');
    expect(result.cleanAverage).toBe(30);
  });
});

// ── Structural: both sites import from priceChangeSanity ─────────────────────

describe('import-presence: both call sites import flagAnomalousChanges', () => {
  it('suiteeTools.ts imports from ./priceChangeSanity', () => {
    const src = fs.readFileSync(path.join(SRC, 'suiteeTools.ts'), 'utf-8');
    expect(src).toContain("from './priceChangeSanity'");
  });

  it('api.ts imports from ./priceChangeSanity', () => {
    const src = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf-8');
    expect(src).toContain("from './priceChangeSanity'");
  });
});

// ── Structural: velocityHistory averaging is untouched ───────────────────────

describe('api.ts velocityHistory averaging is a plain average (out of scope)', () => {
  it('the velocityHistory section is a plain reduce/length average with no flagAnomalousChanges call', () => {
    const src = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf-8');
    const start = src.indexOf('const vh: number[]');
    expect(start).toBeGreaterThan(0); // confirm the section exists

    // Extract a generous window around the velocityHistory averaging code
    const section = src.slice(start, start + 600);

    // Plain reduce average is still there
    expect(section).toContain('vh.reduce((a: number, b: number) => a + b, 0) / vh.length');

    // The sanity utility is NOT referenced in this section
    expect(section).not.toContain('flagAnomalousChanges');
  });
});
