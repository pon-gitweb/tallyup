/**
 * Tests for the active !== false filter added to visibleRows in
 * SetupProductsPage (Handoff 2).
 *
 * Strategy: mirror the exact filter condition as a pure TypeScript helper —
 * no React or Firebase dependency needed.  Same pattern as
 * HistoricalInvoiceTab.test.ts.
 */

import { describe, it, expect } from 'vitest'

// ── Minimal product shape (only the fields the filter touches) ────────────────

type ProductStub = {
  id: string
  name: string
  active?: boolean
}

// ── Helper mirroring the production filter ────────────────────────────────────

/** Mirrors `products.filter(p => p.active !== false)` from visibleRows. */
function filterActive(products: ProductStub[]): ProductStub[] {
  return products.filter(p => p.active !== false)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACTIVE_EXPLICIT: ProductStub = { id: 'p1', name: 'Sauvignon Blanc 750ml', active: true }
const ACTIVE_ABSENT: ProductStub   = { id: 'p2', name: 'Pinot Noir 750ml' }          // field absent
const MERGED_AWAY: ProductStub     = { id: 'p3', name: 'Old Duplicate Gin', active: false }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SetupProductsPage — active filter (Handoff 2)', () => {
  it('a product with active: false is excluded from the list', () => {
    const result = filterActive([MERGED_AWAY])
    expect(result).toHaveLength(0)
  })

  it('a product with active: true is included', () => {
    const result = filterActive([ACTIVE_EXPLICIT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('a product with no active field (the documented default) is included', () => {
    const result = filterActive([ACTIVE_ABSENT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p2')
  })

  it('mixed list — only active !== false products survive', () => {
    const result = filterActive([ACTIVE_EXPLICIT, ACTIVE_ABSENT, MERGED_AWAY])
    expect(result).toHaveLength(2)
    expect(result.map(p => p.id)).toContain('p1')
    expect(result.map(p => p.id)).toContain('p2')
    expect(result.map(p => p.id)).not.toContain('p3')
  })

  it('all merged-away → empty list', () => {
    const allMerged: ProductStub[] = [
      { id: 'x1', name: 'A', active: false },
      { id: 'x2', name: 'B', active: false },
    ]
    expect(filterActive(allMerged)).toHaveLength(0)
  })

  it('empty input → empty output', () => {
    expect(filterActive([])).toHaveLength(0)
  })

  it('uses the identical condition as findDuplicatePairs: !== false, not === true', () => {
    // This test documents the intent: undefined is treated as active, not excluded.
    // If the condition were === true, the absent-field product would be wrongly excluded.
    const absent: ProductStub = { id: 'z1', name: 'No Field Product' }
    const filtered = filterActive([absent])
    expect(filtered).toHaveLength(1) // absent field → included, same as active: true
  })
})
