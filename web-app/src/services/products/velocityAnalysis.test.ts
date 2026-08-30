/**
 * Regression tests for computeVelocity — the product-velocity grouping fix.
 *
 * The bug being fixed: grouping by raw stamped name caused a product renamed
 * between cycles to be silently split into two disconnected series — one under
 * the old name, one under the new — often dropping one below the 2-data-point
 * threshold and making it disappear from the trend report entirely.
 *
 * Required scenarios (per spec):
 *   a) Product renamed once mid-history → one continuous series, current name
 *   b) Full merge chain across history  → same continuous-series requirement
 *   c) Never-renamed product            → output identical to pre-fix (regression guard)
 *   d) Item with no productId           → name-based grouping, no crash, does NOT
 *      merge with an unrelated product reached via a different resolution path
 */

import { describe, it, expect } from 'vitest'
import { computeVelocity, type VelocityItem } from './velocityAnalysis'
import { type ProdEntry } from './resolveProduct'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProdById(
  products: Array<{
    id: string
    name: string
    active?: boolean
    mergedInto?: string | null
  }>,
): Record<string, ProdEntry> {
  const map: Record<string, ProdEntry> = {}
  for (const p of products) {
    map[p.id] = {
      name: p.name,
      category: 'Uncategorised',
      active: p.active ?? true,
      mergedInto: p.mergedInto ?? null,
    }
  }
  return map
}

function item(
  productId: string | null,
  name: string,
  cycleNumber: number,
  qty: number,
  supplierName: string | null = null,
): VelocityItem {
  return { productId, name, cycleNumber, actualClosing: qty, supplierName }
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('computeVelocity', () => {
  // ── scenario (a) ───────────────────────────────────────────────────────────
  describe('(a) product renamed once mid-history', () => {
    it('produces a single continuous series spanning the rename', () => {
      //  Cycle 1-3: stamped as "Guinness Keg 25litre"
      //  Cycle 4-5: stamped as "Guinness Keg 50litre" (after rename)
      //  Both cycles share the same productId.
      const prodById = makeProdById([
        { id: 'prod-1', name: 'Guinness Keg 50litre' },
      ])
      const items: VelocityItem[] = [
        item('prod-1', 'Guinness Keg 25litre', 1, 10),
        item('prod-1', 'Guinness Keg 25litre', 2, 8),
        item('prod-1', 'Guinness Keg 25litre', 3, 6),
        item('prod-1', 'Guinness Keg 50litre', 4, 4),
        item('prod-1', 'Guinness Keg 50litre', 5, 2),
      ]

      const rows = computeVelocity(items, prodById)

      // Exactly one row — the two names must NOT produce two separate series
      expect(rows).toHaveLength(1)

      // Displayed under the current live name
      expect(rows[0].name).toBe('Guinness Keg 50litre')

      // 5 data points → High confidence
      expect(rows[0].confidence).toBe('High')
    })

    it('uses the correct consumption figures across the full series', () => {
      // Steady consumption of 2 units per cycle before and after rename.
      const prodById = makeProdById([
        { id: 'prod-1', name: 'Current Name' },
      ])
      const items: VelocityItem[] = [
        item('prod-1', 'Old Name', 1, 20),
        item('prod-1', 'Old Name', 2, 18),  // consumed 2
        item('prod-1', 'Current Name', 3, 16),  // consumed 2
        item('prod-1', 'Current Name', 4, 14),  // consumed 2
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(1)
      // avg consumed = 2 per cycle; /2 weeks = 1 unit/week
      expect(rows[0].unitsPerWeek).toBeCloseTo(1)
    })

    it('regression: old grouping-by-name would have dropped this product entirely', () => {
      // With the old bug, 3 cycles under "Old Name" and 1 under "New Name"
      // → "New Name" series has only 1 data point and would be dropped (< 2).
      // The fix must keep it.
      const prodById = makeProdById([
        { id: 'prod-x', name: 'New Name' },
      ])
      const items: VelocityItem[] = [
        item('prod-x', 'Old Name', 1, 30),
        item('prod-x', 'Old Name', 2, 25),
        item('prod-x', 'Old Name', 3, 20),
        item('prod-x', 'New Name', 4, 15),  // only 1 cycle under new name
      ]

      const rows = computeVelocity(items, prodById)

      // Must not be dropped
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('New Name')
      expect(rows[0].confidence).toBe('Medium')  // 4 data points
    })
  })

  // ── scenario (b) ───────────────────────────────────────────────────────────
  describe('(b) merge chain (defunct product merged into survivor)', () => {
    it('reconnects history from the defunct product to the survivor', () => {
      // prod-old was merged into prod-new.
      // Early snapshot items carry productId=prod-old; later ones prod-new.
      const prodById = makeProdById([
        { id: 'prod-old', name: 'Old Keg',  active: false, mergedInto: 'prod-new' },
        { id: 'prod-new', name: 'New Keg',  active: true  },
      ])
      const items: VelocityItem[] = [
        item('prod-old', 'Old Keg', 1, 12),
        item('prod-old', 'Old Keg', 2, 9),
        item('prod-new', 'New Keg', 3, 6),
        item('prod-new', 'New Keg', 4, 3),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('New Keg')
      expect(rows[0].confidence).toBe('Medium')  // 4 data points
    })

    it('handles a 2-hop merge chain correctly', () => {
      const prodById = makeProdById([
        { id: 'prod-a', name: 'A', active: false, mergedInto: 'prod-b' },
        { id: 'prod-b', name: 'B', active: false, mergedInto: 'prod-c' },
        { id: 'prod-c', name: 'C', active: true  },
      ])
      const items: VelocityItem[] = [
        item('prod-a', 'A', 1, 10),
        item('prod-b', 'B', 2, 8),
        item('prod-c', 'C', 3, 6),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('C')
    })
  })

  // ── scenario (c) ───────────────────────────────────────────────────────────
  describe('(c) never-renamed product — regression guard', () => {
    it('produces the same output as before this change for a stable product', () => {
      // A product whose name has never changed.  The fix must not affect its output.
      const prodById = makeProdById([
        { id: 'prod-stable', name: 'Heineken 330ml' },
      ])
      const items: VelocityItem[] = [
        item('prod-stable', 'Heineken 330ml', 1, 24),
        item('prod-stable', 'Heineken 330ml', 2, 18),
        item('prod-stable', 'Heineken 330ml', 3, 12),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Heineken 330ml')
      expect(rows[0].confidence).toBe('Medium')  // 3 data points
      // consumed 6 per cycle → /2 weeks = 3 units/week
      expect(rows[0].unitsPerWeek).toBeCloseTo(3)
    })

    it('two distinct never-renamed products each produce their own separate row', () => {
      const prodById = makeProdById([
        { id: 'prod-a', name: 'Beer A' },
        { id: 'prod-b', name: 'Beer B' },
      ])
      const items: VelocityItem[] = [
        item('prod-a', 'Beer A', 1, 10),
        item('prod-a', 'Beer A', 2, 8),
        item('prod-b', 'Beer B', 1, 20),
        item('prod-b', 'Beer B', 2, 16),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(2)
      const names = rows.map(r => r.name).sort()
      expect(names).toEqual(['Beer A', 'Beer B'])
    })
  })

  // ── scenario (d) ───────────────────────────────────────────────────────────
  describe('(d) item with no productId — name-based fallback', () => {
    it('falls back to name-based grouping without crashing', () => {
      const prodById = makeProdById([])  // no products in catalogue
      const items: VelocityItem[] = [
        item(null, 'Legacy Product', 1, 5),
        item(null, 'Legacy Product', 2, 3),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Legacy Product')
    })

    it('does NOT merge a name-fallback item with a separate productId-resolved item that shares the same name', () => {
      // "Water 500ml" appears as:
      //   - productId=null items (legacy snapshots) → grouped under the raw name "Water 500ml"
      //   - productId="prod-water" items (newer snapshots) → grouped under "prod-water" id
      // These must remain separate series.
      const prodById = makeProdById([
        { id: 'prod-water', name: 'Water 500ml' },
      ])
      const items: VelocityItem[] = [
        item(null,         'Water 500ml', 1, 10),   // legacy — no productId
        item(null,         'Water 500ml', 2, 8),    // legacy — no productId
        item('prod-water', 'Water 500ml', 3, 6),    // newer  — has productId
        item('prod-water', 'Water 500ml', 4, 4),    // newer  — has productId
      ]

      const rows = computeVelocity(items, prodById)

      // Two separate series: one keyed by raw name, one keyed by prod id
      expect(rows).toHaveLength(2)
    })

    it('skips an item that has neither productId nor a non-empty name', () => {
      const prodById = makeProdById([])
      const items: VelocityItem[] = [
        item(null, '', 1, 5),
        item(null, '', 2, 3),
      ]

      const rows = computeVelocity(items, prodById)

      expect(rows).toHaveLength(0)
    })
  })

  // ── deleted product ─────────────────────────────────────────────────────────
  describe('deleted product (productId present but not in catalogue)', () => {
    it('keeps history together under the productId and shows the last stamped name', () => {
      const prodById = makeProdById([])  // product has been deleted
      const items: VelocityItem[] = [
        item('deleted-id', 'Ghost Product Old', 1, 8),
        item('deleted-id', 'Ghost Product New', 2, 5),
      ]

      const rows = computeVelocity(items, prodById)

      // Still grouped together (same productId) — one series, not zero
      expect(rows).toHaveLength(1)
      // Display falls back to most recent stamped name
      expect(rows[0].name).toBe('Ghost Product New')
    })
  })
})
