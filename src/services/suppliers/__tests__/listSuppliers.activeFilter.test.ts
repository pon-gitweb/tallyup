/**
 * Tests for the active !== false filter added to both canonical listSuppliers
 * functions (3a-i).
 *
 * Strategy: test the filter predicate as a pure helper — no Firebase imports
 * needed.  Mirrors the product active-filter convention exactly.
 */

// ── Mirror of the production filter condition ─────────────────────────────────

/** Returns true when a supplier document should surface to callers. */
function shouldInclude(data: Record<string, any>): boolean {
  return data?.active !== false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('listSuppliers — active filter (data.active !== false)', () => {

  it('L1: supplier with active:false is excluded', () => {
    expect(shouldInclude({ name: 'Gone Supplier', active: false })).toBe(false);
  });

  it('L2: supplier with active:true is included', () => {
    expect(shouldInclude({ name: 'Active Co', active: true })).toBe(true);
  });

  it('L3: supplier with active field absent is included (field absent = active)', () => {
    expect(shouldInclude({ name: 'No Field Supplier' })).toBe(true);
  });

  it('L4: supplier with active:null is included (null is not false)', () => {
    expect(shouldInclude({ name: 'Null Co', active: null })).toBe(true);
  });

  it('L5: mixed list — only non-false-active suppliers pass', () => {
    const docs = [
      { name: 'Active',    active: true  },
      { name: 'Deleted',   active: false },
      { name: 'NoField'                  },
      { name: 'NullField', active: null  },
    ];
    const visible = docs.filter(shouldInclude);
    expect(visible.map(d => d.name)).toEqual(['Active', 'NoField', 'NullField']);
    expect(visible.find(d => d.name === 'Deleted')).toBeUndefined();
  });

  it('L6: all-inactive list returns empty', () => {
    const docs = [{ active: false }, { active: false }];
    expect(docs.filter(shouldInclude)).toHaveLength(0);
  });

  it('L7: active:false takes precedence over any other truthy field', () => {
    expect(shouldInclude({ name: 'Looks Real', active: false, email: 'x@y.com' })).toBe(false);
  });
});
