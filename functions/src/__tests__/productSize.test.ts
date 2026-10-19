import { parseProductSize, ParsedSize } from '../productSize'

describe('parseProductSize', () => {
  const cases: Array<[string | null | undefined, string | null | undefined, ParsedSize | null]> = [
    // ml variants
    ['750ml',          undefined,  { amount: 750,  base: 'ml' }],
    ['750ML',          undefined,  { amount: 750,  base: 'ml' }],
    ['700 ml',         undefined,  { amount: 700,  base: 'ml' }],
    ['1.5L',           undefined,  { amount: 1500, base: 'ml' }],
    ['1 litre',        undefined,  { amount: 1000, base: 'ml' }],
    ['2L Bottle',      undefined,  { amount: 2000, base: 'ml' }],
    ['5L Container',   undefined,  { amount: 5000, base: 'ml' }],
    ['70cl',           undefined,  { amount: 700,  base: 'ml' }],
    // g/kg variants
    ['1kg Dry/Bag',    undefined,  { amount: 1000, base: 'g' }],
    ['200g Sachet',    undefined,  { amount: 200,  base: 'g' }],
    ['5000g Sachet',   undefined,  { amount: 5000, base: 'g' }],
    // each
    ['- Each',         undefined,  { amount: 1, base: 'each' }],
    ['each',           undefined,  { amount: 1, base: 'each' }],
    // null / empty → null
    ['',               undefined,  null],
    [null,             undefined,  null],
    [undefined,        undefined,  null],
    // unit field fallback
    [null,             'each',     { amount: 1, base: 'each' }],
    ['',               'each',     { amount: 1, base: 'each' }],
  ]

  test.each(cases)('parseProductSize(%j, %j) → %j', (size, unit, expected) => {
    expect(parseProductSize(size, unit)).toEqual(expected)
  })

  it('handles litres and liters spellings', () => {
    expect(parseProductSize('1litres')).toEqual({ amount: 1000, base: 'ml' })
    expect(parseProductSize('1liters')).toEqual({ amount: 1000, base: 'ml' })
    expect(parseProductSize('1liter')).toEqual({ amount: 1000, base: 'ml' })
  })

  it('returns null for unrecognised unit tokens', () => {
    expect(parseProductSize('500oz')).toBeNull()
    expect(parseProductSize('1pint')).toBeNull()
  })
})
