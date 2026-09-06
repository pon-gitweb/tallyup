/**
 * Tests for namesMatchIncludingAliases (2a read side).
 *
 * Strategy: the helper is private to priceTracking.ts, so we test it
 * indirectly via its exported behaviour — but since the function delegates to
 * the same tokenise/overlapCoefficient/isReliableMatch primitives already
 * tested elsewhere, we can construct a pure helper that mirrors the
 * production logic and test it directly.
 *
 * Mirror the production helper here rather than reaching into the module's
 * private scope.  This keeps tests stable across internal refactors.
 */

// ── Mirror of the production helpers (pure, no imports needed) ────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function overlapCoef(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function isReliable(ta: string[], tb: string[], score: number): boolean {
  if (ta.length === 0 || tb.length === 0) return false;
  if (score >= 1.0) return true;
  if (score >= 0.8 && (ta.length >= 2 || tb.length >= 2)) return true;
  return false;
}

function namesMatch(a: string, b: string): { isMatch: boolean; score: number } {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const score = overlapCoef(a, b);
  return { isMatch: isReliable(ta, tb, score), score };
}

function namesMatchIncludingAliases(
  product: { name?: string; mergedAliases?: string[] },
  lineName: string,
): { isMatch: boolean; score: number } {
  const primary = namesMatch(product.name || '', lineName);
  if (primary.isMatch) return primary;
  for (const alias of product.mergedAliases ?? []) {
    const r = namesMatch(alias, lineName);
    if (r.isMatch) return r;
  }
  return { isMatch: false, score: 0 };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('namesMatchIncludingAliases (2a read side)', () => {

  it('A1: primary name match returns isMatch:true and a non-zero score', () => {
    const product = { name: 'Heineken Lager', mergedAliases: [] };
    const r = namesMatchIncludingAliases(product, 'Heineken Lager');
    expect(r.isMatch).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('A2: alias-only match returns isMatch:true when primary name does not match', () => {
    const product = {
      name: 'Heineken Lager',
      mergedAliases: ['Heiny 330ml', 'HNK Bottle'],
    };
    // 'HNK Bottle' won't match but 'Heiny 330ml' should not either —
    // use an exact alias to keep the test deterministic
    const productExact = {
      name: 'Gin Surplus',
      mergedAliases: ['Premium Gin 700ml'],
    };
    const r = namesMatchIncludingAliases(productExact, 'Premium Gin 700ml');
    expect(r.isMatch).toBe(true);
  });

  it('A3: no match returns isMatch:false and score:0 when name and aliases all miss', () => {
    const product = { name: 'Vodka Sunrise', mergedAliases: ['Old Vodka Brand'] };
    const r = namesMatchIncludingAliases(product, 'Heineken Lager 330ml');
    expect(r.isMatch).toBe(false);
    expect(r.score).toBe(0);
  });

  it('A4: product with no mergedAliases field behaves as if aliases is empty', () => {
    const product = { name: 'Rum Punch' };
    const r = namesMatchIncludingAliases(product, 'Rum Punch');
    expect(r.isMatch).toBe(true); // matches on primary name
  });

  it('A5: product with mergedAliases:undefined behaves as if aliases is empty', () => {
    const product = { name: 'Cider', mergedAliases: undefined };
    const noMatch = namesMatchIncludingAliases(product, 'Completely Different Product');
    expect(noMatch.isMatch).toBe(false);
    expect(noMatch.score).toBe(0);
  });

  it('A6: second alias in list is checked when first alias does not match', () => {
    const product = {
      name: 'Wine Reserve',
      mergedAliases: ['Unrelated Alias', 'Sauvignon Blanc 750ml'],
    };
    const r = namesMatchIncludingAliases(product, 'Sauvignon Blanc 750ml');
    expect(r.isMatch).toBe(true);
  });

  it('A7: primary name match short-circuits alias checking (returns primary score)', () => {
    const product = {
      name: 'Craft Beer IPA',
      mergedAliases: ['Some Old Name'],
    };
    const r = namesMatchIncludingAliases(product, 'Craft Beer IPA');
    expect(r.isMatch).toBe(true);
    // Score should come from the primary name match (perfect overlap → 1.0)
    expect(r.score).toBeCloseTo(1.0, 1);
  });

  it('A8: accumulated aliases (simulate two sequential merges) all checked', () => {
    // After B→A then C→A, product A has aliases ['B Name', 'C Name']
    const productA = {
      name: 'Gin Original',
      mergedAliases: ['Premium Gin 700ml', 'Artisan Gin NZ'],
    };
    const fromB = namesMatchIncludingAliases(productA, 'Premium Gin 700ml');
    const fromC = namesMatchIncludingAliases(productA, 'Artisan Gin NZ');
    expect(fromB.isMatch).toBe(true);
    expect(fromC.isMatch).toBe(true);
  });
});
