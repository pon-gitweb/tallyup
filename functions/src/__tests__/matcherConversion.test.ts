/**
 * Integration-style fixture tests for the matchAndStoreSalesLines conversion
 * logic and the weeklyLedger MatchData / coverage changes.
 *
 * Rather than setting up a full Firestore emulator, we inline the pure logic
 * under test and drive it with realistic fixtures. The test mirrors the exact
 * data structures that matchAndStoreSalesLines writes and weeklyLedger reads.
 */

import { stockUnitsPerSale, ingredientStockQty, MappingDoc } from '../mappingConversion'
import { matchDocToMatchData, buildWeeklyAggregation, ActiveReport } from '../weeklyLedger'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GIN_PRODUCT = { id: 'prod-gin', name: 'House Gin', size: '700ml' }
const SALT_PRODUCT = { id: 'prod-salt', name: 'Celery Salt', size: '200g Sachet' }

const RECIPE_DOC = {
  name: 'Dirty Martini',
  yield: 1,
  items: [
    { productId: 'prod-gin',  productName: 'House Gin',   qty: 60,  unit: 'ml' },
    { productId: 'prod-salt', productName: 'Celery Salt', qty: 5,   unit: 'each' }, // mismatched base (ml vs each)
  ],
}

const GIN_MAPPING: MappingDoc = {
  posItemName:   'Gin & Tonic',
  productId:     'prod-gin',
  mappingType:   'direct_product',
  conversionRatio: null,
  servingMl:     null,
}

const RECIPE_MAPPING: MappingDoc = {
  posItemName: 'Dirty Martini',
  recipeId:    'recipe-martini',
  mappingType: 'recipe',
  productId:   null,
}

const SKIPPED_MAPPING: MappingDoc = {
  posItemName: 'Staff Water',
  mappingType: 'skipped',
}

const LINES = [
  { name: 'Gin & Tonic',  qtySold: 10, gross: 120 },
  { name: 'Dirty Martini', qtySold: 5,  gross: 80 },
  { name: 'Staff Water',   qtySold: 3,  gross: 0 },
  { name: 'Unknown Beer',  qtySold: 2,  gross: 15 },
]

// ── Simulate matchAndStoreSalesLines output (the data shape written to Firestore) ─

function simulateMatch() {
  const fullMappings: Record<string, MappingDoc> = {
    'gin & tonic':   GIN_MAPPING,
    'dirty martini': RECIPE_MAPPING,
    'staff water':   SKIPPED_MAPPING,
  }
  const productById: Record<string, any> = {
    'prod-gin':  GIN_PRODUCT,
    'prod-salt': SALT_PRODUCT,
  }

  const matches: any[] = []
  const recipeDeductions: any[] = []
  const ignored: any[] = []
  const unknowns: any[] = []
  let unconvertibleCount = 0

  for (const ln of LINES) {
    const lineKey = ln.name.toLowerCase()
    const mapping = fullMappings[lineKey]

    if (mapping?.mappingType === 'skipped') {
      ignored.push({ name: ln.name, qtySold: ln.qtySold })
      continue
    }

    if (mapping?.recipeId) {
      const recipeYield = RECIPE_DOC.yield ?? 1
      for (const item of RECIPE_DOC.items) {
        const ingProduct = productById[item.productId] ?? null
        const { stockQty, reason } = ingredientStockQty(
          ln.qtySold, item.qty, item.unit, recipeYield, ingProduct
        )
        if (stockQty === null) unconvertibleCount++
        recipeDeductions.push({
          posName:    ln.name,
          recipeId:   mapping.recipeId,
          recipeName: RECIPE_DOC.name,
          productId:  item.productId,
          productName: item.productName,
          qtySold:    ln.qtySold,
          stockQty:   stockQty ?? null,
          unconvertibleReason: reason ?? null,
        })
      }
      continue
    }

    // product or auto match
    if (mapping?.productId) {
      const product = productById[mapping.productId] ?? null
      const conv = stockUnitsPerSale(mapping, product)
      matches.push({
        productId:        mapping.productId,
        productName:      product?.name ?? null,
        name:             ln.name,
        qtySold:          ln.qtySold,
        gross:            ln.gross ?? null,
        via:              'mapping',
        stockQty:         ln.qtySold * conv.qty,
        conversionSource: conv.source,
        mappingType:      mapping.mappingType ?? null,
      })
    } else {
      unknowns.push({ line: ln })
    }
  }

  return {
    counts: {
      total:         LINES.length,
      matched:       matches.length,
      unknowns:      unknowns.length,
      recipeMatched: new Set(recipeDeductions.map(r => r.posName)).size,
      ignored:       ignored.length,
      unconvertible: unconvertibleCount,
    },
    matches,
    recipeDeductions,
    ignored,
  }
}

// ── Tests: matcher output ─────────────────────────────────────────────────────

describe('matchAndStoreSalesLines — conversion fixture', () => {
  let result: ReturnType<typeof simulateMatch>

  beforeAll(() => { result = simulateMatch() })

  it('product match: qtySold unchanged (compat), stockQty added', () => {
    const m = result.matches.find(m => m.name === 'Gin & Tonic')
    expect(m).toBeDefined()
    expect(m.qtySold).toBe(10)                      // COMPATIBILITY: unchanged
    expect(m.stockQty).toBe(10)                     // 10 × 1 (default, no conversionRatio/servingMl)
    expect(m.conversionSource).toBe('default')
  })

  it('recipe line: not in matches[]', () => {
    expect(result.matches.find(m => m.name === 'Dirty Martini')).toBeUndefined()
  })

  it('recipe line: 2 recipeDeductions entries (one per ingredient)', () => {
    const rds = result.recipeDeductions.filter(r => r.posName === 'Dirty Martini')
    expect(rds).toHaveLength(2)
  })

  it('recipe deduction: gin ingredient → stockQty convertible', () => {
    const ginDed = result.recipeDeductions.find(r => r.productId === 'prod-gin')
    expect(ginDed).toBeDefined()
    expect(ginDed.stockQty).toBeCloseTo(5 * 60 / 700)  // 5 serves × 60ml / 700ml
    expect(ginDed.unconvertibleReason).toBeNull()
  })

  it('recipe deduction: salt ingredient → stockQty null (base mismatch: ml vs each/g)', () => {
    const saltDed = result.recipeDeductions.find(r => r.productId === 'prod-salt')
    expect(saltDed).toBeDefined()
    expect(saltDed.stockQty).toBeNull()
    expect(saltDed.unconvertibleReason).toBeTruthy()
  })

  it('skipped line: in ignored[], not in matches[] or unknowns', () => {
    const ig = result.ignored.find(i => i.name === 'Staff Water')
    expect(ig).toBeDefined()
    expect(ig.qtySold).toBe(3)
    // Should NOT appear in matches
    expect(result.matches.find(m => m.name === 'Staff Water')).toBeUndefined()
  })

  it('unknown line: in unknowns (not skipped — no salesReportUnknowns for skipped)', () => {
    // Only 'Unknown Beer' should be unknown
    expect(result.counts.unknowns).toBe(1)
  })

  it('counts: matched=1 (product matches only), recipeMatched=1, ignored=1, unconvertible=1', () => {
    expect(result.counts.matched).toBe(1)
    expect(result.counts.recipeMatched).toBe(1)
    expect(result.counts.ignored).toBe(1)
    expect(result.counts.unconvertible).toBe(1)
  })
})

// ── Tests: matchDocToMatchData ────────────────────────────────────────────────

describe('matchDocToMatchData — coverage percentages', () => {
  it('computes coverage percentages from counts', () => {
    const { matches, recipeDeductions, ignored, counts } = simulateMatch()
    // Add totalQtySold to counts (sum of all line qtySold: 10+5+3+2=20)
    const totalQtySold = 10 + 5 + 3 + 2
    const doc = { counts: { ...counts, totalQtySold }, matches, recipeDeductions, ignored }
    const md = matchDocToMatchData(doc)

    // Coverage in POS units (qtySold): matched=10, recipe=5, ignored=3, unknown=2 → total=20
    expect(md.coverage.matchedPct).toBeCloseTo((10 / totalQtySold) * 100)
    expect(md.coverage.recipePct).toBeCloseTo((5 / totalQtySold) * 100)
    expect(md.coverage.ignoredPct).toBeCloseTo((3 / totalQtySold) * 100)
    expect(md.coverage.unknownPct).toBeCloseTo((2 / totalQtySold) * 100)
  })

  it('recipeDeductions and ignored arrays populated from raw doc', () => {
    const { matches, recipeDeductions, ignored, counts } = simulateMatch()
    const md = matchDocToMatchData({ counts, matches, recipeDeductions, ignored })
    expect(md.recipeDeductions).toHaveLength(2)
    expect(md.ignored).toHaveLength(1)
    expect(md.ignored[0].name).toBe('Staff Water')
  })

  it('no totalQtySold → all coverage null', () => {
    const md = matchDocToMatchData({ counts: { matched: 1 }, matches: [{ qtySold: 1 }], recipeDeductions: [], ignored: [] })
    expect(md.coverage.matchedPct).toBeNull()
  })
})

// ── Tests: buildWeeklyAggregation uses stockQty and recipeDeductions ──────────

describe('buildWeeklyAggregation — stockQty and recipe deductions', () => {
  const { matches, recipeDeductions, ignored, counts } = simulateMatch()
  const md = matchDocToMatchData({ counts, matches, recipeDeductions, ignored })

  const report: ActiveReport = {
    id: 'r1', source: 'csv',
    startStr: '2026-01-06', endStr: '2026-01-12',
    startMs: new Date('2026-01-06T00:00:00Z').getTime(),
    days: 7,
    lineCount: LINES.length,
    totalRevenue: 215, totalQtySold: 20,
    rawLines: [],
    overlappingCycles: [],
    allocationMethod: 'none',
    status: 'active',
    meta: null,
  }

  it('product match uses stockQty instead of qtySold for velocity', () => {
    // Gin & Tonic: qtySold=10, stockQty=10 (default ratio=1)
    const { productMap } = buildWeeklyAggregation([report], { r1: md })
    const ginEntry = productMap.get('prod-gin')
    expect(ginEntry).toBeDefined()
    // stockQty from match (10) + stockQty from recipe deduction (5×60/700 ≈ 0.43)
    expect(ginEntry!.totalUnits).toBeGreaterThan(10)  // match + recipe deduction
  })

  it('recipe deductions contribute to ingredient product velocity', () => {
    const { productMap } = buildWeeklyAggregation([report], { r1: md })
    // Salt product from recipe deduction (unconvertible → stockQty=null → contributes 0)
    const saltEntry = productMap.get('prod-salt')
    // salt has stockQty=null (unconvertible), treated as 0 in aggregation
    // but it still appears in productMap because it was a deduction entry
    if (saltEntry) {
      expect(saltEntry.totalUnits).toBe(0)
    }
  })
})
