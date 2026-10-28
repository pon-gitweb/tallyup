import { describe, it, expect } from 'vitest'
import { suggestCategoryMerges } from './SetupProductsPage'

describe('suggestCategoryMerges', () => {
  it('merges case variants, picks venueList name as canonical', () => {
    const result = suggestCategoryMerges(
      { 'Red Wine': 5, 'red wine': 3 },
      ['Red Wine'],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Red Wine')
    expect(result[0].from).toContain('red wine')
    expect(result[0].count).toBe(8)
  })

  it('merges case variants, picks higher-count name as canonical when no venueList match', () => {
    const result = suggestCategoryMerges(
      { 'Red Wine': 5, 'red wine': 3 },
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Red Wine')
    expect(result[0].from).toContain('red wine')
  })

  it('merges singular/plural, picks more-products name', () => {
    const result = suggestCategoryMerges(
      { 'Wine': 5, 'Wines': 2 },
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Wine')
    expect(result[0].from).toContain('Wines')
    expect(result[0].count).toBe(7)
  })

  it('merges plural with -es suffix', () => {
    const result = suggestCategoryMerges(
      { 'Mango': 4, 'Mangoes': 1 },
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Mango')
  })

  it('merges typo within edit distance 2 (both names >= 5 chars)', () => {
    const result = suggestCategoryMerges(
      { 'Spirits': 10, 'Spirts': 1 },
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Spirits')
    expect(result[0].from).toContain('Spirts')
  })

  it('does NOT merge short names even if similar (< 5 chars each)', () => {
    const result = suggestCategoryMerges(
      { 'Gin': 5, 'Rum': 4 },
      [],
    )
    expect(result).toHaveLength(0)
  })

  it('does NOT merge names with edit distance > 2', () => {
    const result = suggestCategoryMerges(
      { 'Champagne': 5, 'Sparkling': 3 },
      [],
    )
    expect(result).toHaveLength(0)
  })

  it('handles empty input', () => {
    expect(suggestCategoryMerges({}, [])).toHaveLength(0)
  })

  it('handles single category', () => {
    const result = suggestCategoryMerges({ 'Beer': 10 }, ['Beer'])
    expect(result).toHaveLength(0)
  })

  it('groups three-way transitive merge', () => {
    // 'spirits' ~ 'Spirits' (case) ~ 'Spirts' (typo)
    const result = suggestCategoryMerges(
      { 'Spirits': 10, 'spirits': 2, 'Spirts': 1 },
      [],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('Spirits')
    expect(result[0].count).toBe(13)
  })

  it('venueList breaks tie over count', () => {
    const result = suggestCategoryMerges(
      { 'Wine': 5, 'wine': 5 },
      ['wine'],
    )
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('wine')
  })
})
