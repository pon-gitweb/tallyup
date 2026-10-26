import { describe, it, expect, vi } from 'vitest'
import {
  buildNotLinkedRows,
  buildNoServingRows,
  servingPreviewText,
  buildSavePayload,
  rematchReports,
  computeServingFields,
  buildEditPayload,
  buildBulkServingPayloads,
  buildBulkIgnorePayloads,
  unionReportIds,
  allMappingsRows,
  chunkArray,
  type NoServingRow,
  type AllMappingRow,
} from './PosMappingPage'
import type { UnmatchedRow, ActiveReport, MatchData } from '../utils/weeklyLedger'
import { mappingDocId } from '../utils/mappingId'

// ── mappingDocId parity ───────────────────────────────────────────────────────

describe('mappingDocId', () => {
  it('strips apostrophe from Tito\'s Vodka', () => {
    const id = mappingDocId("Tito's Vodka", 'csv')
    expect(id).toBe('titos_vodka_csv')
  })

  it('strips & and extra spaces from J & B Rare Well', () => {
    const id = mappingDocId('J & B Rare Well', 'csv')
    expect(id).toBe('j_b_rare_well_csv')
  })

  it('is identical to the normName-based result from the mobile util', () => {
    expect(mappingDocId('Heineken 330ml', 'square')).toBe('heineken_330ml_square')
    expect(mappingDocId('House Red Wine', 'lightspeed')).toBe('house_red_wine_lightspeed')
  })
})

// ── servingPreviewText ────────────────────────────────────────────────────────

describe('servingPreviewText', () => {
  it('shot 30ml from 700ml bottle', () => {
    const text = servingPreviewText(30, 700)
    expect(text).toContain('30ml of 700ml')
    // 30/700 ≈ 0.04286, rounds to 0.043 at 3dp
    expect(text).toMatch(/0\.04[23]\d*/)
  })

  it('150ml wine glass from 750ml bottle', () => {
    const text = servingPreviewText(150, 750)
    expect(text).toContain('150ml of 750ml')
    expect(text).toContain('0.2')
  })

  it('each (1:1) is handled by the panel directly not servingPreviewText', () => {
    expect(servingPreviewText(0, 700)).toBe('')
    expect(servingPreviewText(30, 0)).toBe('')
  })
})

// ── Tab A classification ──────────────────────────────────────────────────────

describe('buildNotLinkedRows', () => {
  const rows: UnmatchedRow[] = [
    { normalisedName: 'house red', origName: 'House Red', totalQty: 10, totalRevenue: 0, reportCount: 2 },
    { normalisedName: 'heineken', origName: 'Heineken', totalQty: 5, totalRevenue: 0, reportCount: 1 },
    { normalisedName: 'titos vodka', origName: "Tito's Vodka", totalQty: 3, totalRevenue: 0, reportCount: 1 },
  ]

  it('includes rows with no mapping', () => {
    const result = buildNotLinkedRows(rows, {})
    expect(result).toHaveLength(3)
  })

  it('excludes rows that have any mapping (including skipped)', () => {
    const mappings = { 'heineken': { mappingType: 'skipped' } }
    const result = buildNotLinkedRows(rows, mappings)
    expect(result.map(r => r.origName)).not.toContain('Heineken')
    expect(result).toHaveLength(2)
  })

  it('lookup is case-insensitive on origName', () => {
    const mappings = { 'house red': { mappingType: 'direct_product' } }
    const result = buildNotLinkedRows(rows, mappings)
    expect(result.map(r => r.origName)).not.toContain('House Red')
  })

  it("matches Tito's Vodka via lowercase key", () => {
    const mappings = { "tito's vodka": { mappingType: 'direct_product' } }
    const result = buildNotLinkedRows(rows, mappings)
    expect(result.map(r => r.origName)).not.toContain("Tito's Vodka")
  })
})

// ── Tab B classification ──────────────────────────────────────────────────────

describe('buildNoServingRows', () => {
  function makeReport(id: string, lines: { name: string; qtySold: number }[]): ActiveReport {
    return {
      id, source: 'csv', startStr: '2026-10-01', endStr: '2026-10-07', startMs: 0,
      days: 7, lineCount: lines.length, totalRevenue: 0,
      totalQtySold: lines.reduce((s, l) => s + l.qtySold, 0),
      rawLines: lines.map(l => ({ name: l.name, qtySold: l.qtySold })),
      overlappingCycles: [], allocationMethod: 'none', status: null,
    }
  }

  function makeMatchData(matches: { name: string; productId: string; productName: string; qtySold: number; conversionSource?: string | null }[]): MatchData {
    return {
      matched: matches.length, total: matches.length, matchedQty: 0, matchedRevenue: 0,
      matches: matches.map(m => ({ name: m.name, productId: m.productId, productName: m.productName, qtySold: m.qtySold, conversionSource: m.conversionSource })),
    }
  }

  it('new-style: includes rows with conversionSource === default', () => {
    const report = makeReport('r1', [{ name: 'House Red', qtySold: 10 }])
    const md = makeMatchData([{ name: 'House Red', productId: 'p1', productName: 'Chateau Rouge', qtySold: 10, conversionSource: 'default' }])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(1)
    expect(rows[0].posName).toBe('House Red')
    expect(rows[0].productId).toBe('p1')
    expect(rows[0].totalQty).toBe(10)
  })

  it('excludes rows with conversionSource servingMl', () => {
    const report = makeReport('r1', [{ name: 'Heineken', qtySold: 5 }])
    const md = makeMatchData([{ name: 'Heineken', productId: 'p2', productName: 'Heineken 330ml', qtySold: 5, conversionSource: 'servingMl' }])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(0)
  })

  it('excludes rows with conversionSource each', () => {
    const report = makeReport('r1', [{ name: 'Lime', qtySold: 20 }])
    const md = makeMatchData([{ name: 'Lime', productId: 'p3', productName: 'Lime', qtySold: 20, conversionSource: 'each' }])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(0)
  })

  it('legacy: no conversionSource, no mapping → included', () => {
    const report = makeReport('r1', [{ name: 'House Sav', qtySold: 7 }])
    const md = makeMatchData([{ name: 'House Sav', productId: 'p4', productName: 'Sauvignon Blanc', qtySold: 7, conversionSource: null }])
    const rows = buildNoServingRows([report], { r1: md }, {})
    expect(rows).toHaveLength(1)
    expect(rows[0].posName).toBe('House Sav')
  })

  it('legacy: no conversionSource, mapping has conversionRatio → excluded', () => {
    const report = makeReport('r1', [{ name: 'House Sav', qtySold: 7 }])
    const md = makeMatchData([{ name: 'House Sav', productId: 'p4', productName: 'Sauvignon Blanc', qtySold: 7, conversionSource: null }])
    const mappings = { 'house sav': { mappingType: 'direct_product', conversionRatio: 0.04, servingMl: null } }
    const rows = buildNoServingRows([report], { r1: md }, mappings)
    expect(rows).toHaveLength(0)
  })

  it('legacy: no conversionSource, mapping has servingMl → excluded', () => {
    const report = makeReport('r1', [{ name: 'Pinot Noir', qtySold: 4 }])
    const md = makeMatchData([{ name: 'Pinot Noir', productId: 'p5', productName: 'Central Otago Pinot', qtySold: 4, conversionSource: null }])
    const mappings = { 'pinot noir': { mappingType: 'direct_product', servingMl: 150, conversionRatio: null } }
    const rows = buildNoServingRows([report], { r1: md }, mappings)
    expect(rows).toHaveLength(0)
  })

  it('legacy: no conversionSource, recipe mapping → excluded', () => {
    const report = makeReport('r1', [{ name: 'Margarita', qtySold: 3 }])
    const md = makeMatchData([{ name: 'Margarita', productId: 'p6', productName: 'Lime', qtySold: 3, conversionSource: null }])
    const mappings = { 'margarita': { mappingType: 'recipe', servingMl: null, conversionRatio: null } }
    const rows = buildNoServingRows([report], { r1: md }, mappings)
    expect(rows).toHaveLength(0)
  })

  it('two POS names for one product → two separate rows', () => {
    const report = makeReport('r1', [
      { name: 'House Red Glass', qtySold: 10 },
      { name: 'House Red Bottle', qtySold: 3 },
    ])
    const md = makeMatchData([
      { name: 'House Red Glass',  productId: 'p1', productName: 'Rouge', qtySold: 10, conversionSource: 'default' },
      { name: 'House Red Bottle', productId: 'p1', productName: 'Rouge', qtySold: 3,  conversionSource: 'default' },
    ])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(2)
    const names = rows.map(r => r.posName)
    expect(names).toContain('House Red Glass')
    expect(names).toContain('House Red Bottle')
  })

  it('aggregates qty across multiple reports for same POS name', () => {
    const r1 = makeReport('r1', [{ name: 'House Red', qtySold: 10 }])
    const r2 = makeReport('r2', [{ name: 'House Red', qtySold: 8 }])
    const md1 = makeMatchData([{ name: 'House Red', productId: 'p1', productName: 'Rouge', qtySold: 10, conversionSource: 'default' }])
    const md2 = makeMatchData([{ name: 'House Red', productId: 'p1', productName: 'Rouge', qtySold: 8, conversionSource: 'default' }])
    const rows = buildNoServingRows([r1, r2], { r1: md1, r2: md2 })
    expect(rows).toHaveLength(1)
    expect(rows[0].totalQty).toBe(18)
    expect(rows[0].reportIds).toEqual(expect.arrayContaining(['r1', 'r2']))
  })
})

// ── buildSavePayload ──────────────────────────────────────────────────────────

describe('buildSavePayload', () => {
  it('direct_product payload has no undefined values', () => {
    const payload = buildSavePayload('House Red', 'csv', 'direct_product', {
      productId: 'p1', productName: 'Chateau Rouge', servingMl: 150, conversionRatio: 0.2, servingType: 'wine_glass', conversionUnit: 'ml',
    })
    const json = JSON.stringify(payload)
    expect(json).not.toContain('undefined')
    expect(payload.posItemName).toBe('House Red')
    expect(payload.mappingType).toBe('direct_product')
    expect(payload.servingMl).toBe(150)
    expect(payload.recipeId).toBeNull()
  })

  it('skipped payload has null product/recipe fields', () => {
    const payload = buildSavePayload("Tito's Vodka", 'csv', 'skipped', {})
    expect(payload.mappingType).toBe('skipped')
    expect(payload.productId).toBeNull()
    expect(payload.recipeId).toBeNull()
    expect(payload.servingMl).toBeNull()
  })

  it('recipe payload stores recipeId and null productId', () => {
    const payload = buildSavePayload('Margarita', 'csv', 'recipe', { recipeId: 'rec1', recipeName: 'Classic Margarita' })
    expect(payload.recipeId).toBe('rec1')
    expect(payload.productId).toBeNull()
  })
})

// ── rematchReports continues after failure ────────────────────────────────────

describe('rematchReports', () => {
  it('continues after a failing report and reports errors', async () => {
    let callCount = 0
    const progressCalls: Array<[number, number]> = []

    global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      callCount++
      const body = JSON.parse(opts.body as string)
      if (body.reportId === 'r2') {
        return Promise.resolve({ ok: false, status: 500 } as Response)
      }
      return Promise.resolve({ ok: true } as Response)
    }) as any

    const { errors } = await rematchReports(
      'venue1',
      ['r1', 'r2', 'r3'],
      'tok',
      (done, total) => progressCalls.push([done, total]),
    )

    expect(callCount).toBe(3)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('r2')
    expect(errors[0]).toContain('500')
    expect(progressCalls).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('continues after a network error', async () => {
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue({ ok: true } as Response) as any

    const { errors } = await rematchReports('v', ['r1', 'r2'], 'tok', () => {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('network timeout')
  })
})

// ── computeServingFields ──────────────────────────────────────────────────────

describe('computeServingFields', () => {
  it('each preset returns null ml and ratio, each unit', () => {
    const r = computeServingFields('each', '', null)
    expect(r).toEqual({ servingMl: null, conversionRatio: null, servingType: 'each', conversionUnit: 'each' })
  })

  it('full_bottle with known size returns ratio=1', () => {
    const r = computeServingFields('full_bottle', '', 700)
    expect(r).toEqual({ servingMl: 700, conversionRatio: 1, servingType: 'full_bottle', conversionUnit: 'ml' })
  })

  it('full_bottle with null size returns skip', () => {
    const r = computeServingFields('full_bottle', '', null)
    expect(r).toHaveProperty('skip')
  })

  it('wine_glass 150ml from 750ml bottle → ratio 0.2', () => {
    const r = computeServingFields('wine_glass', '', 750)
    expect('skip' in r).toBe(false)
    if (!('skip' in r)) {
      expect(r.servingMl).toBe(150)
      expect(r.conversionRatio).toBeCloseTo(0.2)
      expect(r.servingType).toBe('wine_glass')
      expect(r.conversionUnit).toBe('ml')
    }
  })

  it('shot 30ml, no size → conversionRatio null', () => {
    const r = computeServingFields('shot', '', null)
    expect('skip' in r).toBe(false)
    if (!('skip' in r)) {
      expect(r.servingMl).toBe(30)
      expect(r.conversionRatio).toBeNull()
    }
  })

  it('custom ml valid string', () => {
    const r = computeServingFields('custom', '200', 1000)
    expect('skip' in r).toBe(false)
    if (!('skip' in r)) {
      expect(r.servingMl).toBe(200)
      expect(r.conversionRatio).toBeCloseTo(0.2)
    }
  })

  it('custom ml invalid string → servingMl null', () => {
    const r = computeServingFields('custom', 'abc', 1000)
    expect('skip' in r).toBe(false)
    if (!('skip' in r)) {
      expect(r.servingMl).toBeNull()
      expect(r.conversionRatio).toBeNull()
    }
  })

  it('custom ml zero → servingMl null', () => {
    const r = computeServingFields('custom', '0', 1000)
    expect('skip' in r).toBe(false)
    if (!('skip' in r)) {
      expect(r.servingMl).toBeNull()
    }
  })
})

// ── buildEditPayload ──────────────────────────────────────────────────────────

describe('buildEditPayload', () => {
  const existingProduct = { id: 'p1', name: 'Chateau Rouge', size: '750ml', unit: null }
  const existingMapping = {
    id: 'doc1', posItemName: 'House Red', posSystem: 'csv',
    mappingType: 'direct_product', productId: 'p1', productName: 'Chateau Rouge',
    createdAt: 'ts-original',
  }

  it('carries createdAt from existing', () => {
    const { createdAt } = buildEditPayload(existingMapping, {
      mode: 'product', product: existingProduct, servingPreset: 'each',
    })
    expect(createdAt).toBe('ts-original')
  })

  it('skip mode produces skipped payload', () => {
    const { payload } = buildEditPayload(existingMapping, { mode: 'skip' })
    expect(payload.mappingType).toBe('skipped')
    expect(payload.productId).toBeNull()
  })

  it('recipe mode stores recipe fields', () => {
    const { payload } = buildEditPayload(existingMapping, {
      mode: 'recipe', recipe: { id: 'rec1', name: 'Classic Margarita' },
    })
    expect(payload.mappingType).toBe('recipe')
    expect(payload.recipeId).toBe('rec1')
    expect(payload.productId).toBeNull()
  })

  it('product with wine_glass serving computes ratio', () => {
    const { payload } = buildEditPayload(existingMapping, {
      mode: 'product', product: { id: 'p1', name: 'Chateau Rouge', size: '750ml', unit: null },
      servingPreset: 'wine_glass',
    })
    expect(payload.servingMl).toBe(150)
    expect((payload.conversionRatio as number)).toBeCloseTo(0.2)
    expect(payload.servingType).toBe('wine_glass')
  })

  it('product with each serving → null ml and ratio', () => {
    const { payload } = buildEditPayload(existingMapping, {
      mode: 'product', product: existingProduct, servingPreset: 'each',
    })
    expect(payload.servingMl).toBeNull()
    expect(payload.conversionRatio).toBeNull()
    expect(payload.conversionUnit).toBe('each')
  })

  it('null createdAt when existing has none', () => {
    const noCreatedAt = { posItemName: 'X', posSystem: 'csv' }
    const { createdAt } = buildEditPayload(noCreatedAt, { mode: 'skip' })
    expect(createdAt).toBeNull()
  })
})

// ── buildBulkIgnorePayloads ───────────────────────────────────────────────────

describe('buildBulkIgnorePayloads', () => {
  it('returns one payload per name', () => {
    const result = buildBulkIgnorePayloads(['House Red', 'Heineken'])
    expect(result).toHaveLength(2)
    expect(result.every(r => r.payload.mappingType === 'skipped')).toBe(true)
    expect(result.every(r => r.payload.productId === null)).toBe(true)
  })

  it('docId matches mappingDocId', () => {
    const result = buildBulkIgnorePayloads(["Tito's Vodka"])
    expect(result[0].docId).toBe(mappingDocId("Tito's Vodka", 'csv'))
  })
})

// ── buildBulkServingPayloads ──────────────────────────────────────────────────

describe('buildBulkServingPayloads', () => {
  const products = [
    { id: 'p1', name: 'Sauvignon Blanc', size: '750ml', unit: null },
    { id: 'p2', name: 'Beer', size: '330ml', unit: null },
    { id: 'p3', name: 'Lime', size: null, unit: null },
  ]

  const rows: NoServingRow[] = [
    { posName: 'House Sav', normalisedName: 'house sav', productId: 'p1', productName: 'Sauvignon Blanc', totalQty: 10, reportIds: ['r1'] },
    { posName: 'Draught Beer', normalisedName: 'draught beer', productId: 'p2', productName: 'Beer', totalQty: 8, reportIds: ['r1'] },
    { posName: 'Lime', normalisedName: 'lime', productId: 'p3', productName: 'Lime', totalQty: 5, reportIds: ['r1'] },
    { posName: 'Unknown Product', normalisedName: 'unknown product', productId: 'p999', productName: '?', totalQty: 3, reportIds: ['r1'] },
  ]

  it('wine_glass 150ml on 750ml product → ratio 0.2', () => {
    const result = buildBulkServingPayloads([rows[0]], products, 'wine_glass', '')
    expect('skip' in result[0]).toBe(false)
    const r = result[0] as { posName: string; docId: string; payload: Record<string, unknown> }
    expect(r.payload.servingMl).toBe(150)
    expect((r.payload.conversionRatio as number)).toBeCloseTo(0.2)
  })

  it('product with no size → conversionRatio null, servingMl set', () => {
    const result = buildBulkServingPayloads([rows[2]], products, 'wine_glass', '')
    expect('skip' in result[0]).toBe(false)
    const r = result[0] as { posName: string; docId: string; payload: Record<string, unknown> }
    expect(r.payload.servingMl).toBe(150)
    expect(r.payload.conversionRatio).toBeNull()
  })

  it('product not found in products → skip', () => {
    const result = buildBulkServingPayloads([rows[3]], products, 'wine_glass', '')
    expect('skip' in result[0]).toBe(true)
    expect((result[0] as any).skip).toContain('product not found')
  })

  it('full_bottle with no size product → skip', () => {
    const result = buildBulkServingPayloads([rows[2]], products, 'full_bottle', '')
    expect('skip' in result[0]).toBe(true)
  })

  it('each preset → each conversionUnit', () => {
    const result = buildBulkServingPayloads([rows[0]], products, 'each', '')
    expect('skip' in result[0]).toBe(false)
    const r = result[0] as { posName: string; docId: string; payload: Record<string, unknown> }
    expect(r.payload.conversionUnit).toBe('each')
    expect(r.payload.conversionRatio).toBeNull()
  })

  it('processes multiple rows, mixed skip and success', () => {
    const result = buildBulkServingPayloads(rows, products, 'wine_glass', '')
    const successes = result.filter(r => !('skip' in r))
    const skips = result.filter(r => 'skip' in r)
    expect(successes.length).toBe(3) // p1, p2, p3 all have servingMl=150; p3 has null ratio
    expect(skips.length).toBe(1)   // p999 not found
  })
})

// ── unionReportIds ────────────────────────────────────────────────────────────

describe('unionReportIds', () => {
  function makeReport(id: string, names: string[]): ActiveReport {
    return {
      id, source: 'csv', startStr: '2026-10-01', endStr: '2026-10-07', startMs: 0,
      days: 7, lineCount: names.length, totalRevenue: 0, totalQtySold: 0,
      rawLines: names.map(n => ({ name: n, qtySold: 0 })),
      overlappingCycles: [], allocationMethod: 'none', status: null,
    }
  }

  it('returns report ids that contain any of the named POS items', () => {
    const reports = [
      makeReport('r1', ['House Red', 'Heineken']),
      makeReport('r2', ['Heineken', 'Lime']),
      makeReport('r3', ['Chardonnay']),
    ]
    const ids = unionReportIds(['House Red'], reports)
    expect(ids).toContain('r1')
    expect(ids).not.toContain('r2')
    expect(ids).not.toContain('r3')
  })

  it('de-dupes report ids when multiple names appear in the same report', () => {
    const reports = [makeReport('r1', ['House Red', 'House Red Glass'])]
    const ids = unionReportIds(['House Red', 'House Red Glass'], reports)
    expect(ids).toHaveLength(1)
    expect(ids).toContain('r1')
  })

  it('returns empty array when no reports match', () => {
    const reports = [makeReport('r1', ['House Red'])]
    const ids = unionReportIds(['Chardonnay'], reports)
    expect(ids).toHaveLength(0)
  })

  it('normalises names for comparison', () => {
    const reports = [makeReport('r1', ["Tito's Vodka"])]
    const ids = unionReportIds(["Tito's Vodka"], reports)
    expect(ids).toContain('r1')
  })
})

// ── allMappingsRows ───────────────────────────────────────────────────────────

describe('allMappingsRows', () => {
  const products = [
    { id: 'p1', name: 'Chateau Rouge', size: '750', unit: 'ml', mergedInto: null },
    { id: 'p2', name: 'Old Product',   size: '750', unit: 'ml', mergedInto: 'p1' },
  ]
  const recipes = [{ id: 'rec1', name: 'Classic Margarita' }]
  const activeReports: ActiveReport[] = []
  const matchesByReport = {}

  it('direct_product with active product → targetLabel = product name, no warning', () => {
    const mappings = [{ id: 'd1', posItemName: 'House Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', productName: 'Chateau Rouge' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].targetLabel).toBe('Chateau Rouge')
    expect(rows[0].warningMergedOrMissing).toBe(false)
  })

  it('direct_product pointing to merged product → targetLabel shows merger, warning=true', () => {
    const mappings = [{ id: 'd2', posItemName: 'Old Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p2' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].warningMergedOrMissing).toBe(true)
    expect(rows[0].targetLabel).toContain('merged into')
    expect(rows[0].targetLabel).toContain('Chateau Rouge')
  })

  it('direct_product with missing productId → warning=true', () => {
    const mappings = [{ id: 'd3', posItemName: 'Ghost', posSystem: 'csv', mappingType: 'direct_product', productId: 'p999' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].warningMergedOrMissing).toBe(true)
    expect(rows[0].targetLabel).toBe('(missing product)')
  })

  it('recipe mapping → targetLabel = recipe name', () => {
    const mappings = [{ id: 'd4', posItemName: 'Margarita', posSystem: 'csv', mappingType: 'recipe', recipeId: 'rec1' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].targetLabel).toBe('Classic Margarita')
    expect(rows[0].warningMergedOrMissing).toBe(false)
  })

  it('skipped mapping → targetLabel = Ignored', () => {
    const mappings = [{ id: 'd5', posItemName: 'Tap Water', posSystem: 'csv', mappingType: 'skipped' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].targetLabel).toBe('Ignored')
  })

  it('direct_product with no servingMl or ratio → warningNoServing=true', () => {
    const mappings = [{ id: 'd6', posItemName: 'House Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', servingMl: null, conversionRatio: null, servingType: null }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].warningNoServing).toBe(true)
  })

  it('direct_product with each serving → warningNoServing=false', () => {
    const mappings = [{ id: 'd7', posItemName: 'Lime', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', servingMl: null, conversionRatio: null, servingType: 'each', conversionUnit: 'each' }]
    const rows = allMappingsRows(mappings, products, recipes, activeReports, matchesByReport)
    expect(rows[0].warningNoServing).toBe(false)
  })

  it('seenInReports=0 when no active reports', () => {
    const mappings = [{ id: 'd8', posItemName: 'House Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1' }]
    const rows = allMappingsRows(mappings, products, recipes, [], {})
    expect(rows[0].seenInReports).toBe(0)
    expect(rows[0].totalQtySold).toBe(0)
  })
})

// ── chunkArray ────────────────────────────────────────────────────────────────

describe('chunkArray', () => {
  it('splits evenly', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('last chunk smaller', () => {
    expect(chunkArray([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })

  it('array smaller than chunk size → one chunk', () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]])
  })

  it('empty array → empty result', () => {
    expect(chunkArray([], 5)).toEqual([])
  })

  it('chunks 401 items into [400, 1]', () => {
    const arr = Array.from({ length: 401 }, (_, i) => i)
    const chunks = chunkArray(arr, 400)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(400)
    expect(chunks[1]).toHaveLength(1)
  })
})
