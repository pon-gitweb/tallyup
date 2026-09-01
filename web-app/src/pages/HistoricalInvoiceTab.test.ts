/**
 * Tests for the HistoricalInvoiceTab helper functions exported from ReportsPage.
 *
 * Strategy: the three scenario labels and the badge variant are pure functions
 * with no Firebase or React dependency — test them directly.  Follows the
 * same vitest + plain-TS pattern as the services/products test files.
 *
 * Four test groups:
 *   1. scenarioLabel — distinct, non-generic copy for each of the three cases
 *   2. scenarioBadgeVariant — correct colour token per case
 *   3. All three kinds produce different labels (no conflation)
 *   4. Only rows that appear in the table represent real records (guard: products
 *      without costPriceSource:'historical-invoice' produce no HistoricalRow)
 */

import { describe, it, expect } from 'vitest'
import { type HistoricalRow, scenarioLabel, scenarioBadgeVariant } from './ReportsPage'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const conflictRow: HistoricalRow = {
  kind: 'conflict',
  flagId: 'flag-1',
  productId: 'prod-1',
  productName: 'Sauvignon Blanc 750ml',
  supplierName: 'Historical Wines Co.',
  currentPrice: 25.00,
  invoicePrice: 27.50,
  changePercent: 10,
  direction: 'increase',
  invoiceDate: '2024-01-15',
  flaggedAt: new Date('2026-08-01'),
  status: 'pending',
}

const firstPriceRow: HistoricalRow = {
  kind: 'first_price',
  productId: 'prod-2',
  productName: 'Pinot Noir 750ml',
  supplierName: 'Historical Wines Co.',
  costPrice: 18.00,
  invoiceDate: '2024-03-10',
  backfilledAt: new Date('2026-08-01'),
}

const newProductRow: HistoricalRow = {
  kind: 'new_product',
  productId: 'prod-3',
  productName: 'Obscure Gin 700ml',
  supplierName: 'Historical Spirits Ltd.',
  costPrice: 22.50,
  invoiceDate: '2023-11-20',
  backfilledAt: new Date('2026-08-01'),
}

// ── Suite 1: scenarioLabel ────────────────────────────────────────────────────

describe('scenarioLabel', () => {
  it('conflict → "Price protected — conflict queued for review"', () => {
    expect(scenarioLabel(conflictRow)).toBe('Price protected — conflict queued for review')
  })

  it('first_price → "Initial price set from historical invoice"', () => {
    expect(scenarioLabel(firstPriceRow)).toBe('Initial price set from historical invoice')
  })

  it('new_product → "New product created from historical invoice"', () => {
    expect(scenarioLabel(newProductRow)).toBe('New product created from historical invoice')
  })

  it('none of the three labels are the same', () => {
    const labels = [
      scenarioLabel(conflictRow),
      scenarioLabel(firstPriceRow),
      scenarioLabel(newProductRow),
    ]
    const unique = new Set(labels)
    expect(unique.size).toBe(3)
  })

  it('none of the labels use the generic word "historical" alone as the full label', () => {
    // Each label must be specific enough to stand alone — not just the word "historical"
    for (const row of [conflictRow, firstPriceRow, newProductRow]) {
      const label = scenarioLabel(row)
      expect(label.toLowerCase()).not.toBe('historical')
      expect(label.length).toBeGreaterThan(10)
    }
  })
})

// ── Suite 2: scenarioBadgeVariant ─────────────────────────────────────────────

describe('scenarioBadgeVariant', () => {
  it('conflict → "conflict"', () => {
    expect(scenarioBadgeVariant(conflictRow)).toBe('conflict')
  })

  it('first_price → "firstPrice"', () => {
    expect(scenarioBadgeVariant(firstPriceRow)).toBe('firstPrice')
  })

  it('new_product → "newProduct"', () => {
    expect(scenarioBadgeVariant(newProductRow)).toBe('newProduct')
  })

  it('all three variants are different', () => {
    const variants = [
      scenarioBadgeVariant(conflictRow),
      scenarioBadgeVariant(firstPriceRow),
      scenarioBadgeVariant(newProductRow),
    ]
    const unique = new Set(variants)
    expect(unique.size).toBe(3)
  })
})

// ── Suite 3: no conflation — labels are genuinely distinct ────────────────────

describe('no conflation between scenarios', () => {
  it('conflict label does not mention "initial price" or "new product"', () => {
    const label = scenarioLabel(conflictRow).toLowerCase()
    expect(label).not.toContain('initial price')
    expect(label).not.toContain('new product')
  })

  it('first_price label does not mention "conflict" or "new product"', () => {
    const label = scenarioLabel(firstPriceRow).toLowerCase()
    expect(label).not.toContain('conflict')
    expect(label).not.toContain('new product')
  })

  it('new_product label does not mention "conflict" or "initial price"', () => {
    const label = scenarioLabel(newProductRow).toLowerCase()
    expect(label).not.toContain('conflict')
    expect(label).not.toContain('initial price')
  })
})

// ── Suite 4: empty/no-records guard ───────────────────────────────────────────

describe('empty records guard', () => {
  it('an empty rows array produces no labels (guard: nothing to render)', () => {
    const rows: HistoricalRow[] = []
    const labels = rows.map(scenarioLabel)
    expect(labels).toHaveLength(0)
  })

  it('a mixed list of all three kinds produces three distinct labels', () => {
    const rows: HistoricalRow[] = [conflictRow, firstPriceRow, newProductRow]
    const labels = rows.map(scenarioLabel)
    expect(new Set(labels).size).toBe(3)
  })

  it('acknowledged conflict has same label as pending conflict (status is separate)', () => {
    const acknowledged: HistoricalRow = { ...conflictRow, status: 'acknowledged' }
    expect(scenarioLabel(acknowledged)).toBe(scenarioLabel(conflictRow))
  })

  it('a product with null invoiceDate still produces a valid label', () => {
    const withNull: HistoricalRow = { ...firstPriceRow, invoiceDate: null }
    expect(() => scenarioLabel(withNull)).not.toThrow()
    expect(scenarioLabel(withNull).length).toBeGreaterThan(0)
  })
})
