/**
 * Tests for computeSupplierSpend — the supplier-spend grouping fix.
 *
 * The bug being fixed: grouping by raw supplierName caused a supplier renamed
 * between cycles to be silently split into two disconnected spend totals, each
 * potentially understating spend and dropping a supplier off the "top 8" ranking
 * they should actually dominate.
 *
 * The partial fix (forward-looking only): snapshot items now carry supplierId
 * (stamped by snapshotWriter Part A). Items with a supplierId are grouped by id;
 * items that pre-date the stamp are grouped by name. The correct, honest
 * behaviour for a supplier with a mix of both is two separate rows — not a
 * guessed merge.
 *
 * Required scenarios (per spec):
 *   a) Name-only historical items → grouped by name (pre-fix behaviour unchanged)
 *   b) ID-stamped items           → grouped by id, displayed under supplier name
 *   c) Mix of both                → two separate rows, not one falsely merged row
 */

import { describe, it, expect } from 'vitest'
import { computeSupplierSpend, type SpendItem } from './supplierAnalysis'

// ── Helpers ──────────────────────────────────────────────────────────────────

function item(
  supplierId: string | null,
  supplierName: string | null,
  actualClosing: number,
  costPrice: number,
): SpendItem {
  return { supplierId, supplierName, actualClosing, costPrice, displayCostPrice: null }
}

function itemWithDisplay(
  supplierId: string | null,
  supplierName: string | null,
  actualClosing: number,
  displayCostPrice: number,
): SpendItem {
  return { supplierId, supplierName, actualClosing, costPrice: null, displayCostPrice }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('computeSupplierSpend', () => {
  // ── scenario (a) ─────────────────────────────────────────────────────────
  describe('(a) name-only historical items — pre-fix grouping unchanged', () => {
    it('groups items with supplierId=null by supplierName', () => {
      const items: SpendItem[] = [
        item(null, 'Acme Beverages', 10, 5),    // $50 spend
        item(null, 'Acme Beverages', 5,  5),    // $25 spend → total $75
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(1)
      expect(rows[0].supplier).toBe('Acme Beverages')
      expect(rows[0].total).toBeCloseTo(75)
      expect(rows[0].count).toBe(2)
    })

    it('two different suppliers with no id produce two separate rows', () => {
      const items: SpendItem[] = [
        item(null, 'Acme Beverages', 10, 5),
        item(null, 'Bidfood NZ',     8,  3),
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(2)
      const names = rows.map(r => r.supplier).sort()
      expect(names).toEqual(['Acme Beverages', 'Bidfood NZ'])
    })

    it('skips items with no supplierId AND no supplierName', () => {
      const items: SpendItem[] = [
        item(null, null, 10, 5),
        item(null, 'Acme Beverages', 5, 5),
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(1)
      expect(rows[0].supplier).toBe('Acme Beverages')
    })
  })

  // ── scenario (b) ─────────────────────────────────────────────────────────
  describe('(b) ID-stamped items — grouped by supplierId, displayed by name', () => {
    it('groups items with matching supplierId into one bucket', () => {
      const items: SpendItem[] = [
        item('sup-123', 'Acme Beverages', 10, 5),
        item('sup-123', 'Acme Beverages', 5,  5),
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(1)
      expect(rows[0].supplier).toBe('Acme Beverages')
      expect(rows[0].total).toBeCloseTo(75)
    })

    it('uses supplierId as the grouping key so a renamed supplier stays in one bucket', () => {
      // Cycles 1-3: supplierName stamped as "Acme Beverages"
      // Cycles 4-5: supplierName stamped as "Acme Drinks Ltd" (after rename)
      // Both carry supplierId = 'sup-123' → must land in one bucket.
      const items: SpendItem[] = [
        item('sup-123', 'Acme Beverages',  10, 5),
        item('sup-123', 'Acme Beverages',   8, 5),
        item('sup-123', 'Acme Drinks Ltd',  6, 5),
        item('sup-123', 'Acme Drinks Ltd',  4, 5),
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(1)
      expect(rows[0].total).toBeCloseTo((10 + 8 + 6 + 4) * 5) // 140
    })

    it('prefers displayCostPrice over costPrice (Phase W2 consistency)', () => {
      const items: SpendItem[] = [
        itemWithDisplay('sup-123', 'Acme', 10, 8),  // effective = display 8, costPrice=null
      ]

      const rows = computeSupplierSpend(items)

      expect(rows[0].total).toBeCloseTo(80)
      expect(rows[0].avgCost).toBeCloseTo(8)
    })

    it('skips items with a supplierId but zero/null cost price', () => {
      const items: SpendItem[] = [
        { supplierId: 'sup-123', supplierName: 'Acme', actualClosing: 10, costPrice: null, displayCostPrice: null },
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(0)
    })
  })

  // ── scenario (c) ─────────────────────────────────────────────────────────
  describe('(c) mix of name-only and ID-stamped items — two rows, not one', () => {
    it('produces two separate rows rather than one falsely merged row', () => {
      // Pre-fix items (no supplierId) grouped under their name.
      // Post-fix items (supplierId) grouped under their id.
      // Even though both refer to "Acme Beverages", they must NOT be merged —
      // the correct outcome is two rows until enough id-stamped data accumulates.
      const items: SpendItem[] = [
        item(null,      'Acme Beverages', 10, 5),  // legacy — name-only
        item(null,      'Acme Beverages',  8, 5),  // legacy — name-only
        item('sup-123', 'Acme Beverages',  6, 5),  // post-fix — has id
        item('sup-123', 'Acme Beverages',  4, 5),  // post-fix — has id
      ]

      const rows = computeSupplierSpend(items)

      // Two separate rows — the honest split
      expect(rows).toHaveLength(2)

      const nameRow = rows.find(r => r.total === (10 + 8) * 5)
      const idRow   = rows.find(r => r.total === (6  + 4) * 5)
      expect(nameRow).toBeDefined()
      expect(idRow).toBeDefined()

      // Both display under the same supplier name
      expect(nameRow!.supplier).toBe('Acme Beverages')
      expect(idRow!.supplier).toBe('Acme Beverages')
    })

    it('different suppliers with id-stamped items each produce their own row', () => {
      const items: SpendItem[] = [
        item('sup-A', 'Alpha Drinks', 10, 5),
        item('sup-B', 'Beta Wines',    8, 3),
      ]

      const rows = computeSupplierSpend(items)

      expect(rows).toHaveLength(2)
      const names = rows.map(r => r.supplier).sort()
      expect(names).toEqual(['Alpha Drinks', 'Beta Wines'])
    })
  })
})
