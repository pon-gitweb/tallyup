/**
 * Tests for resolveProduct + the currentName annotation logic used in
 * ReportsPage's Unexplained Variance table.
 *
 * Four required scenarios:
 *   1. Product renamed → row shows stamped name AND "(now <current>)"
 *   2. Product name unchanged → no annotation (currentName is null)
 *   3. Unresolvable productId (deleted/absent) → no annotation
 *   4. Merge chain (defunct → survivor) → uses survivor's current name
 */

import { describe, it, expect } from 'vitest'
import { type ProdEntry, buildProductMaps, resolveProduct } from './resolveProduct'
import { type QuerySnapshot, type DocumentData } from 'firebase/firestore'

// ── Minimal fake QuerySnapshot ──────────────────────────────────────────────

function makeSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>): QuerySnapshot<DocumentData> {
  return {
    forEach(cb: (d: any) => void) {
      for (const d of docs) cb({ id: d.id, data: () => d.data })
    },
    docs: docs.map(d => ({ id: d.id, data: () => d.data })),
  } as unknown as QuerySnapshot<DocumentData>
}

// ── The same derivation logic as in ReportsPage.loadReports ─────────────────

function deriveCurrentName(
  stampedName: string,
  productId: string | null | undefined,
  prodById: Record<string, ProdEntry>,
): string | null {
  const resolvedId = typeof productId === 'string' && productId ? productId : null
  const resolved = resolvedId ? resolveProduct(resolvedId, prodById) : null
  const resolvedName = resolved?.entry.name ?? null
  return resolvedName && resolvedName !== stampedName ? resolvedName : null
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveProduct + currentName annotation', () => {
  it('1. renamed product: currentName equals the new live name', () => {
    const snap = makeSnapshot([
      { id: 'prod-1', data: { name: 'Guinness Keg 50litre', active: true } },
    ])
    const { prodById } = buildProductMaps(snap)

    // Snapshot was stamped with the old name
    const currentName = deriveCurrentName('Guinness Keg 25litre', 'prod-1', prodById)

    expect(currentName).toBe('Guinness Keg 50litre')
  })

  it('2. unchanged product name: currentName is null (no annotation)', () => {
    const snap = makeSnapshot([
      { id: 'prod-2', data: { name: 'Heineken 330ml', active: true } },
    ])
    const { prodById } = buildProductMaps(snap)

    const currentName = deriveCurrentName('Heineken 330ml', 'prod-2', prodById)

    expect(currentName).toBeNull()
  })

  it('3. unresolvable productId (product deleted): currentName is null', () => {
    const snap = makeSnapshot([]) // empty — no products
    const { prodById } = buildProductMaps(snap)

    const currentName = deriveCurrentName('Old Product Name', 'missing-prod-id', prodById)

    expect(currentName).toBeNull()
  })

  it('3b. absent productId field: currentName is null', () => {
    const snap = makeSnapshot([])
    const { prodById } = buildProductMaps(snap)

    const currentName = deriveCurrentName('Some Product', null, prodById)

    expect(currentName).toBeNull()
  })

  it('4. merge chain (defunct → survivor): currentName reflects the survivor', () => {
    // prod-old was merged into prod-new; prod-old is inactive with a mergedInto pointer
    const snap = makeSnapshot([
      { id: 'prod-old', data: { name: 'Guinness Keg 25litre', active: false, mergedInto: 'prod-new' } },
      { id: 'prod-new', data: { name: 'Guinness Keg 50litre', active: true } },
    ])
    const { prodById } = buildProductMaps(snap)

    // Snapshot item has productId pointing to the now-defunct product
    const currentName = deriveCurrentName('Guinness Keg 25litre', 'prod-old', prodById)

    // Should resolve through the chain to the survivor's current name
    expect(currentName).toBe('Guinness Keg 50litre')
  })

  it('4b. merge chain where survivor name matches stamped name: no annotation', () => {
    // The defunct product pointed to a survivor whose name happens to match the stamped name
    const snap = makeSnapshot([
      { id: 'prod-old', data: { name: 'Some Keg', active: false, mergedInto: 'prod-new' } },
      { id: 'prod-new', data: { name: 'Same Name As Stamped', active: true } },
    ])
    const { prodById } = buildProductMaps(snap)

    const currentName = deriveCurrentName('Same Name As Stamped', 'prod-old', prodById)

    // Names match even though it went through a chain → no annotation
    expect(currentName).toBeNull()
  })
})
