/**
 * Tests for the active-product filter added to ProductsScreen.
 *
 * The fix: the `filtered` useMemo now starts with
 *   `let base = rows.filter((p: any) => p.active !== false);`
 * before applying any search/supplier/unassigned filters.
 *
 * Strategy: the filter predicate is pure — test it as an extracted helper
 * mirroring the production condition, with no React / Firebase imports.
 * Follows the style of other test files in this project.
 */

// ── Helper mirroring the production filter condition ──────────────────────────

/** Returns true when the product should appear in the list. */
function isActiveProduct(p: { active?: boolean | null }): boolean {
  return p.active !== false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProductsScreen — active filter (p.active !== false)', () => {

  it('A1: product with active:false is hidden', () => {
    expect(isActiveProduct({ active: false })).toBe(false);
  });

  it('A2: product with active:true is shown', () => {
    expect(isActiveProduct({ active: true })).toBe(true);
  });

  it('A3: product with active field absent (undefined) is shown — field-absent means active', () => {
    expect(isActiveProduct({})).toBe(true);
  });

  it('A4: product with active:null is shown — null is not false', () => {
    expect(isActiveProduct({ active: null })).toBe(true);
  });

  it('A5: filter applied to a mixed list returns only non-false-active products', () => {
    const rows = [
      { id: 'p1', name: 'Heineken',  active: true  },
      { id: 'p2', name: 'Inactive',  active: false },
      { id: 'p3', name: 'NoField'                  },
      { id: 'p4', name: 'NullField', active: null  },
    ];

    const visible = rows.filter(p => isActiveProduct(p));

    expect(visible.map(p => p.id)).toEqual(['p1', 'p3', 'p4']);
    expect(visible.find(p => p.id === 'p2')).toBeUndefined();
  });

  it('A6: all-inactive list returns empty (no false-positives)', () => {
    const rows = [
      { id: 'x1', active: false },
      { id: 'x2', active: false },
    ];
    expect(rows.filter(isActiveProduct)).toHaveLength(0);
  });
});
