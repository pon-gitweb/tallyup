import { parsePackUnits, detectCaseMismatch, buildCaseMismatchFields } from '../detectCaseMismatch';

// ── parsePackUnits ────────────────────────────────────────────────────────────

describe('parsePackUnits — multiply pattern (NxM, no unit suffix)', () => {
  it.each([
    ['4x6',                    24, 'multiplied'],
    ['4 x 6',                  24, 'multiplied'],
    ['4×6',                    24, 'multiplied'],
    ['Schweppes Soda Water 4x6', 24, 'multiplied'],
    ['product 2x12 500ml',     24, 'multiplied'],  // "2x12" comes before "500ml"
  ])('%s → %d (%s)', (name, units, source) => {
    const r = parsePackUnits(name);
    expect(r).not.toBeNull();
    expect(r!.units).toBe(units);
    expect(r!.source).toBe(source);
  });
});

describe('parsePackUnits — count pattern (N x <volume>unit)', () => {
  it.each([
    ['24 x 330ml',   24, 'count'],
    ['12 x 375ml',   12, 'count'],
    ['24x1L',        24, 'count'],
    ['6 x 330ml',     6, 'count'],
    ['48 x 250ml',   48, 'count'],
    ['18 x 500ML',   18, 'count'],
  ])('%s → %d (%s)', (name, units, source) => {
    const r = parsePackUnits(name);
    expect(r).not.toBeNull();
    expect(r!.units).toBe(units);
    expect(r!.source).toBe(source);
  });
});

describe('parsePackUnits — explicit count words', () => {
  it.each([
    ['case of 24',   24, 'explicit'],
    ['24 per case',  24, 'explicit'],
    ['ctn 24',       24, 'explicit'],
    ['24pk',         24, 'explicit'],
    ['24 pack',      24, 'explicit'],
    ['x24',          24, 'explicit'],
    ['24 cases',     24, 'explicit'],
    ['Lager x24',    24, 'explicit'],
  ])('%s → %d (%s)', (name, units, source) => {
    const r = parsePackUnits(name);
    expect(r).not.toBeNull();
    expect(r!.units).toBe(units);
    expect(r!.source).toBe(source);
  });
});

describe('parsePackUnits — null cases (ambiguous or out of range)', () => {
  it.each([
    ['plain product name'],
    ['1x1'],          // product = 1, below 2
    ['1x100'],        // product = 100, above 96
    ['100 x 330ml'],  // 100 out of range
    ['12.5 oz can'],  // no x pattern
    ['$24.95'],       // number but no pack pattern
  ])('%s → null', (name) => {
    expect(parsePackUnits(name)).toBeNull();
  });
});

describe('parsePackUnits — dimension suffix (NxM skipped, not a pack count)', () => {
  it.each([
    ['Wipes Roll Heavy Duty Blue 30x50cm 90pc'],  // physical size, not 30 packs
    ['12x330mm'],                                  // mm is a dimension
    ['Cloth 2x3m'],                                // m is a dimension
    ['Panel 4x8in'],                               // in is a dimension
  ])('%s → null', (name) => {
    expect(parsePackUnits(name)).toBeNull();
  });

  it('still parses count when volume suffix follows ("24 x 330ml" not affected)', () => {
    const r = parsePackUnits('24 x 330ml');
    expect(r).not.toBeNull();
    expect(r!.units).toBe(24);
    expect(r!.source).toBe('count');
  });
});

// ── detectCaseMismatch ────────────────────────────────────────────────────────

describe('detectCaseMismatch — Schweppes case (name_pack)', () => {
  it('flags: ratio 10.16, name "4x6" → N=24, name_pack, corrected ≈ $1.46', () => {
    const r = detectCaseMismatch({
      name: 'Schweppes Soda Water 4x6',
      unitPrice: 34.95,
      existing: 3.44,
    });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('name_pack');
    expect(r.guess).toBe(24);
    expect(r.correctedUnitPrice).toBeCloseTo(34.95 / 24, 4);  // ≈ 1.456
    // corrected change from 3.44 → 1.456 is a decrease (negative %)
    expect(r.correctedChangePercent).toBeLessThan(0);
  });
});

describe('detectCaseMismatch — no-flag guards', () => {
  it('does not flag a genuine 60% rise (ratio 1.6, no pack in name)', () => {
    const r = detectCaseMismatch({ name: 'House White Wine', unitPrice: 16.00, existing: 10.00 });
    expect(r.flag).toBe(false);
  });

  it('does not flag a change of exactly 50% (ratio = 1.5, boundary)', () => {
    const r = detectCaseMismatch({ name: 'Lager 375ml', unitPrice: 1.50, existing: 1.00 });
    expect(r.flag).toBe(false);
  });

  it('does not flag a decrease', () => {
    const r = detectCaseMismatch({ name: 'product 24 pack', unitPrice: 5.00, existing: 10.00 });
    expect(r.flag).toBe(false);
  });

  it('does not flag when existing is 0', () => {
    const r = detectCaseMismatch({ name: 'product 24pk', unitPrice: 34.95, existing: 0 });
    expect(r.flag).toBe(false);
  });

  it('"6 x 330ml" at a normal unit price (ratio 1.1 ≤ 1.5) — no flag', () => {
    const r = detectCaseMismatch({ name: 'Soft Drink 6 x 330ml', unitPrice: 2.20, existing: 2.00 });
    expect(r.flag).toBe(false);
  });
});

describe('detectCaseMismatch — name_pack boundary (ratio = exactly sqrt(N))', () => {
  it('ratio exactly sqrt(24) does NOT fire name_pack (strictly greater-than rule)', () => {
    // ratio = sqrt(24) ≈ 4.899 — just at the boundary, should NOT fire name_pack
    const existing = 1.00;
    const unitPrice = Math.sqrt(24);  // exactly sqrt(24)
    const r = detectCaseMismatch({ name: 'Lager 4x6', unitPrice, existing });
    expect(r.reason).not.toBe('name_pack');
    // big_jump fires (ratio ≈ 4.9 ≥ 4), or ratio_candidate if close enough
    // Either way the REASON is not 'name_pack'
  });

  it('ratio just above sqrt(24) DOES fire name_pack', () => {
    const existing = 1.00;
    const unitPrice = Math.sqrt(24) + 0.01;
    const r = detectCaseMismatch({ name: 'Soda 4x6', unitPrice, existing });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('name_pack');
    expect(r.guess).toBe(24);
  });
});

describe('detectCaseMismatch — case_size rule', () => {
  it('flags when product.caseSize=12 and ratio > sqrt(12)', () => {
    // ratio = 24/2 = 12 > sqrt(12) ≈ 3.46
    const r = detectCaseMismatch({
      name: 'Pale Ale',
      unitPrice: 24.00,
      existing: 2.00,
      productCaseSize: 12,
    });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('case_size');
    expect(r.guess).toBe(12);
    expect(r.correctedUnitPrice).toBeCloseTo(2.00, 4);  // 24/12 = 2.00 = existing, so 0% change
  });

  it('does not fire case_size when ratio <= sqrt(C)', () => {
    // ratio = 3/2 = 1.5 ≤ 1.5 (filtered by the ≤1.5 guard before even reaching case_size)
    const r = detectCaseMismatch({ name: 'product', unitPrice: 3.00, existing: 2.00, productCaseSize: 6 });
    expect(r.flag).toBe(false);
  });
});

describe('detectCaseMismatch — ratio_candidate rule', () => {
  it('flags when ratio is within 15% of a standard pack size (6)', () => {
    // ratio = 6/1 = 6.0, exactly on candidate 6 → ratio_candidate
    const r = detectCaseMismatch({ name: 'Sparkling Water', unitPrice: 6.00, existing: 1.00 });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('ratio_candidate');
    expect(r.guess).toBe(6);
  });

  it('flags ratio near 12 (within 15%)', () => {
    // ratio = 11.5/1 = 11.5 → nearest=12 (|11.5-12|/12 ≈ 4.2%); 10 is 15% off
    const r = detectCaseMismatch({ name: 'Plain Product', unitPrice: 11.50, existing: 1.00 });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('ratio_candidate');
    expect(r.guess).toBe(12);
  });
});

describe('detectCaseMismatch — big_jump rule', () => {
  it('flags ratio >= 4 when no candidate is within 15%', () => {
    // ratio ≈ 4.7 — nearest candidates: 4 (|4.7-4|/4=17.5%) and 6 (|4.7-6|/6=21.7%) → neither ≤15%
    const r = detectCaseMismatch({ name: 'Plain Product', unitPrice: 4.70, existing: 1.00 });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('big_jump');
    expect(r.guess).toBe(4);  // nearest candidate to 4.7
  });

  it('does not fire big_jump when ratio < 4', () => {
    // ratio = 3.4 — nearest=4 (15%+), no ratio_candidate, no big_jump
    const r = detectCaseMismatch({ name: 'Plain Product', unitPrice: 3.40, existing: 1.00 });
    expect(r.flag).toBe(false);
  });
});

describe('detectCaseMismatch — priority ordering', () => {
  it('name_pack takes priority over ratio_candidate even when both match', () => {
    // "24pk" → N=24; ratio 24/1=24 → ratio_candidate also matches (0% from 24)
    // name_pack should fire first
    const r = detectCaseMismatch({ name: 'Lager 24pk', unitPrice: 24.00, existing: 1.00 });
    expect(r.reason).toBe('name_pack');
  });

  it('case_size takes priority over ratio_candidate', () => {
    // productCaseSize=6, ratio=7 > sqrt(6) ≈ 2.45; ratio_candidate also matches 6
    const r = detectCaseMismatch({
      name: 'Beer',
      unitPrice: 7.00,
      existing: 1.00,
      productCaseSize: 6,
    });
    expect(r.reason).toBe('case_size');
  });
});

describe('detectCaseMismatch — line name vs product name priority', () => {
  // Documents expected behaviour: the caller must pass the invoice LINE name
  // (which carries pack info like "4x6") rather than the generic product name.
  // buildCaseMismatchFields (priceTracking) handles this; detectCaseMismatch
  // itself only sees whichever name it is given.

  it('(a) with line name "Schweppes Soda Water 4x6" → name_pack guess=24, corrected ≈ $1.44', () => {
    const r = detectCaseMismatch({
      name: 'Schweppes Soda Water 4x6',
      unitPrice: 34.57,
      existing: 3.44,
    });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('name_pack');
    expect(r.guess).toBe(24);
    expect(r.correctedUnitPrice).toBeCloseTo(34.57 / 24, 4); // ≈ 1.44
  });

  it('(b) with only product name "Water" → ratio_candidate guess=10 (known limitation: no pack text)', () => {
    // ratio = 34.57 / 3.44 ≈ 10.05 → nearest candidate = 10, within 15%
    // This is the "Water" entry from the backtest — the stored price may itself
    // be a poisoned case price, so even the "corrected" $3.46 ≈ $3.44 is wrong.
    // The right fix is always to pass the invoice line name.
    const r = detectCaseMismatch({
      name: 'Water',
      unitPrice: 34.57,
      existing: 3.44,
    });
    expect(r.flag).toBe(true);
    expect(r.reason).toBe('ratio_candidate');
    expect(r.guess).toBe(10);
  });
});

describe('detectCaseMismatch — previously passing cases must still pass', () => {
  it('old 6-candidate match (ratio ≈ 6.0, no name cue)', () => {
    const r = detectCaseMismatch({ name: 'Sparkling Water', unitPrice: 6.12, existing: 1.00 });
    expect(r.flag).toBe(true);
    // 6.12 vs candidate 6: |6.12-6|/6 = 2% → ratio_candidate
    expect(r.reason).toBe('ratio_candidate');
    expect(r.guess).toBe(6);
  });

  it('old 12-candidate match (ratio ≈ 12.0, no name cue)', () => {
    const r = detectCaseMismatch({ name: 'Pale Ale', unitPrice: 12.25, existing: 1.00 });
    expect(r.flag).toBe(true);
    // nearest=12, |12.25-12|/12 ≈ 2% → ratio_candidate
    expect(r.guess).toBe(12);
  });

  it('old 24-candidate match (ratio exactly 24, no name cue)', () => {
    const r = detectCaseMismatch({ name: 'Lager', unitPrice: 24.00, existing: 1.00 });
    expect(r.flag).toBe(true);
    expect(r.guess).toBe(24);
  });
});

// ── buildCaseMismatchFields ───────────────────────────────────────────────────

describe('buildCaseMismatchFields — line name tried first', () => {
  it('line name carries pack info → name_pack, guess=24, corrected ≈ $1.44', () => {
    // Schweppes scenario: invoice line "Schweppes Soda Water 4x6", product name "Water"
    const f = buildCaseMismatchFields({
      lineName: 'Schweppes Soda Water 4x6',
      productName: 'Water',
      unitPrice: 34.57,
      existing: 3.44,
    });
    expect(f.possibleCaseMismatch).toBe(true);
    expect(f.caseMismatchReason).toBe('name_pack');
    expect(f.caseMismatchGuess).toBe(24);
    expect(f.correctedUnitPrice).toBeCloseTo(34.57 / 24, 4);
  });

  it('product name carries pack info when line name has none → name_pack', () => {
    const f = buildCaseMismatchFields({
      lineName: 'Schweppes',
      productName: 'Schweppes Soda Water 4x6',
      unitPrice: 34.57,
      existing: 3.44,
    });
    expect(f.possibleCaseMismatch).toBe(true);
    expect(f.caseMismatchReason).toBe('name_pack');
    expect(f.caseMismatchGuess).toBe(24);
  });

  it('changePercent exactly 50% → no flag (ratio = 1.5, boundary)', () => {
    const f = buildCaseMismatchFields({
      lineName: 'Lager 24pk',
      productName: 'Lager',
      unitPrice: 1.50,
      existing: 1.00,
    });
    expect(f).toEqual({});
  });

  it('price decrease → no flag', () => {
    const f = buildCaseMismatchFields({
      lineName: 'product',
      productName: 'product',
      unitPrice: 5.00,
      existing: 10.00,
    });
    expect(f).toEqual({});
  });

  it('no pack info anywhere → ratio_candidate fires, caseMismatchReason set', () => {
    // ratio ≈ 6.0 → ratio_candidate guess=6
    const f = buildCaseMismatchFields({
      lineName: 'Sparkling Water',
      productName: 'Sparkling Water',
      unitPrice: 6.00,
      existing: 1.00,
    });
    expect(f.possibleCaseMismatch).toBe(true);
    expect(f.caseMismatchReason).toBe('ratio_candidate');
    expect(f.caseMismatchGuess).toBe(6);
  });

  it('returns {} (empty) when no mismatch detected', () => {
    const f = buildCaseMismatchFields({
      lineName: 'House Wine',
      productName: 'House Wine',
      unitPrice: 15.00,
      existing: 12.00,
    });
    expect(f).toEqual({});
  });
});
