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
  planMappingWrites,
  planUnlinkWrites,
  panelCanFixMistake,
  versionTimelineLabel,
  unlinkBlockedReason,
  saveMappingBlockedReason,
  buildChangeProductBody,
  changeProductPreview,
  firstDeliveryDate,
  undoConfirmText,
  buildStraddleDecisions,
  type NoServingRow,
  type AllMappingRow,
  type WriteOp,
  type MappingVersionData,
  type StraddleDecision,
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

// ── planMappingWrites ─────────────────────────────────────────────────────────

type MinMapping = { id: string; posItemName: string; posSystem: string; mappingType: string; createdAt?: unknown; updatedAt?: unknown }

describe('planMappingWrites', () => {
  it('brand-new: uses mappingDocId(name, csv) and no deletes', () => {
    const posName = 'New Item'
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'skipped' }
    const batches = planMappingWrites([{ posName, payload }], [])
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0]).toMatchObject({ kind: 'set', docId: mappingDocId(posName, 'csv'), existingCreatedAt: null })
  })

  it('legacy edit in place: existing doc matches mappingDocId → single set, no deletes', () => {
    const posName = 'House Red'
    const docId = mappingDocId(posName, 'csv')
    const existing: MinMapping[] = [{ id: docId, posItemName: posName, posSystem: 'csv', mappingType: 'direct_product' }]
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', productId: 'p1' }
    const batches = planMappingWrites([{ posName, payload }], existing as any)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0]).toMatchObject({ kind: 'set', docId })
  })

  it('two duplicates collapse: preferred id is canonical, other deleted', () => {
    const posName = 'Chardonnay'
    const canonicalId = mappingDocId(posName, 'csv')
    const legacyId = 'legacy_old_abc'
    const existing: MinMapping[] = [
      { id: legacyId,    posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', updatedAt: { seconds: 100, nanoseconds: 0 } },
      { id: canonicalId, posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', updatedAt: { seconds: 200, nanoseconds: 0 } },
    ]
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', productId: 'p1' }
    const batches = planMappingWrites([{ posName, payload }], existing as any)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    const setOp = batches[0].find(op => op.kind === 'set')!
    const delOp = batches[0].find(op => op.kind === 'delete')!
    expect(setOp).toMatchObject({ kind: 'set', docId: canonicalId })
    expect(delOp).toMatchObject({ kind: 'delete', docId: legacyId })
  })

  it('no preferred id: most recently updated doc is canonical', () => {
    const posName = 'Pinot Noir'
    const existing: MinMapping[] = [
      { id: 'old_id', posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', updatedAt: { seconds: 100, nanoseconds: 0 } },
      { id: 'new_id', posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', updatedAt: { seconds: 200, nanoseconds: 0 } },
    ]
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'direct_product' }
    const batches = planMappingWrites([{ posName, payload }], existing as any)
    const setOp = batches[0].find(op => op.kind === 'set')!
    const delOp = batches[0].find(op => op.kind === 'delete')!
    expect((setOp as any).docId).toBe('new_id')
    expect((delOp as any).docId).toBe('old_id')
  })

  it('uses earliest createdAt from group', () => {
    const posName = 'House Red'
    const existing: MinMapping[] = [
      { id: 'id1', posItemName: posName, posSystem: 'csv', mappingType: 'skipped', createdAt: { seconds: 200, nanoseconds: 0 } },
      { id: 'id2', posItemName: posName, posSystem: 'csv', mappingType: 'skipped', createdAt: { seconds: 100, nanoseconds: 0 } },
    ]
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'skipped' }
    const batches = planMappingWrites([{ posName, payload }], existing as any)
    const setOp = batches[0].find(op => op.kind === 'set') as Extract<WriteOp, { kind: 'set' }>
    expect(setOp.existingCreatedAt).toEqual({ seconds: 100, nanoseconds: 0 })
  })

  it('batch chunking: deletes count toward 400 limit', () => {
    const existing: MinMapping[] = []
    const entries: Array<{ posName: string; payload: Record<string, unknown> }> = []
    for (let i = 0; i < 201; i++) {
      const posName = `Item ${i}`
      const canonicalId = mappingDocId(posName, 'csv')
      const legacyId = `legacy_${i}`
      existing.push(
        { id: canonicalId, posItemName: posName, posSystem: 'csv', mappingType: 'skipped' },
        { id: legacyId,    posItemName: posName, posSystem: 'csv', mappingType: 'skipped' },
      )
      entries.push({ posName, payload: { posItemName: posName, posSystem: 'csv', mappingType: 'skipped' } })
    }
    const batches = planMappingWrites(entries, existing as any)
    expect(batches).toHaveLength(2)
    expect(batches[0].length).toBe(400) // 200 groups × 2 ops each
    expect(batches[1].length).toBe(2)   // 1 group × 2 ops
  })

  it('keeps existing posSystem in canonical doc', () => {
    const posName = 'Square Item'
    const existing: MinMapping[] = [
      { id: 'sid1', posItemName: posName, posSystem: 'square', mappingType: 'direct_product' },
    ]
    const payload = { posItemName: posName, posSystem: 'csv', mappingType: 'direct_product', productId: 'p1' }
    const batches = planMappingWrites([{ posName, payload }], existing as any)
    const setOp = batches[0].find(op => op.kind === 'set') as Extract<WriteOp, { kind: 'set' }>
    expect((setOp.payload as any).posSystem).toBe('square')
  })
})

// ── planUnlinkWrites ──────────────────────────────────────────────────────────

describe('planUnlinkWrites', () => {
  it('returns one batch deleting all docs in group', () => {
    const posName = 'House Red'
    const existing: MinMapping[] = [
      { id: 'id1', posItemName: posName,        posSystem: 'csv', mappingType: 'direct_product' },
      { id: 'id2', posItemName: 'House red',    posSystem: 'csv', mappingType: 'direct_product' },
      { id: 'id3', posItemName: 'HOUSE RED',    posSystem: 'csv', mappingType: 'direct_product' },
    ]
    const batches = planUnlinkWrites(posName, existing as any)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)
    expect(batches[0].every(op => op.kind === 'delete')).toBe(true)
    expect(batches[0].map(op => op.docId).sort()).toEqual(['id1', 'id2', 'id3'].sort())
  })

  it('returns empty array when no group found', () => {
    const batches = planUnlinkWrites('Unknown Item', [])
    expect(batches).toHaveLength(0)
  })

  it('deletes only docs matching the key, not others', () => {
    const existing: MinMapping[] = [
      { id: 'a1', posItemName: 'House Red',  posSystem: 'csv', mappingType: 'direct_product' },
      { id: 'b1', posItemName: 'House White', posSystem: 'csv', mappingType: 'direct_product' },
    ]
    const batches = planUnlinkWrites('House Red', existing as any)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0]).toMatchObject({ kind: 'delete', docId: 'a1' })
  })
})

// ── allMappingsRows duplicate grouping ────────────────────────────────────────

describe('allMappingsRows duplicate grouping', () => {
  const products = [{ id: 'p1', name: 'Red Wine', size: '750', unit: 'ml', mergedInto: null }]
  const recipes: { id: string; name: string }[] = []

  it('groups duplicate docs into one row with docCount and warningDuplicate', () => {
    const mappings = [
      { id: 'id1', posItemName: 'House Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', updatedAt: { seconds: 100, nanoseconds: 0 } },
      { id: 'id2', posItemName: 'house red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', updatedAt: { seconds: 200, nanoseconds: 0 } },
    ]
    const rows = allMappingsRows(mappings as any, products as any, recipes, [], {})
    expect(rows).toHaveLength(1)
    expect(rows[0].docCount).toBe(2)
    expect(rows[0].warningDuplicate).toBe(true)
    expect(rows[0].allMappingIds).toHaveLength(2)
    expect(rows[0].allMappingIds.sort()).toEqual(['id1', 'id2'].sort())
  })

  it('single doc: docCount=1, warningDuplicate=false', () => {
    const mappings = [{ id: 'x1', posItemName: 'Pinot', posSystem: 'csv', mappingType: 'skipped' }]
    const rows = allMappingsRows(mappings as any, products as any, recipes, [], {})
    expect(rows[0].docCount).toBe(1)
    expect(rows[0].warningDuplicate).toBe(false)
    expect(rows[0].allMappingIds).toEqual(['x1'])
  })

  it('uses most-recently-updated doc as representative for the row', () => {
    const mappings = [
      { id: 'old', posItemName: 'House Red', posSystem: 'csv', mappingType: 'skipped',          updatedAt: { seconds: 100, nanoseconds: 0 } },
      { id: 'new', posItemName: 'House Red', posSystem: 'csv', mappingType: 'direct_product', productId: 'p1', updatedAt: { seconds: 200, nanoseconds: 0 } },
    ]
    const rows = allMappingsRows(mappings as any, products as any, recipes, [], {})
    expect(rows[0].mapping.id).toBe('new')
    expect(rows[0].targetLabel).toBe('Red Wine')
  })
})

// ── panelCanFixMistake ────────────────────────────────────────────────────────

describe('panelCanFixMistake', () => {
  it('returns true when no versions exist (unversioned key)', () => {
    expect(panelCanFixMistake([])).toBe(true)
  })

  it('returns false when the key has any versions', () => {
    const v: MappingVersionData = {
      id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01',
      mappingType: 'product', productId: 'p1', productName: 'Product One',
      recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
      servingType: null, conversionUnit: null,
    }
    expect(panelCanFixMistake([v])).toBe(false)
  })

  it('returns false with two versions (v0 + change)', () => {
    const v0: MappingVersionData = {
      id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01',
      mappingType: 'product', productId: 'p1', productName: 'Andre Clouet',
      recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
      servingType: null, conversionUnit: null,
    }
    const v1: MappingVersionData = {
      id: 'v1', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '2026-10-07',
      mappingType: 'product', productId: 'p2', productName: 'Champagne Collet',
      recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
      servingType: null, conversionUnit: null,
    }
    expect(panelCanFixMistake([v0, v1])).toBe(false)
  })
})

// ── versionTimelineLabel ──────────────────────────────────────────────────────

describe('versionTimelineLabel', () => {
  const v0: MappingVersionData = {
    id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01',
    mappingType: 'product', productId: 'p1', productName: 'Andre Clouet',
    recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
    servingType: null, conversionUnit: null,
  }
  const v1: MappingVersionData = {
    id: 'v1', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '2026-10-07',
    mappingType: 'product', productId: 'p2', productName: 'Champagne Collet',
    recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
    servingType: null, conversionUnit: null,
  }

  it('returns empty string when no versions', () => {
    expect(versionTimelineLabel([])).toBe('')
  })

  it('returns empty string when only v0 exists (no real change yet)', () => {
    expect(versionTimelineLabel([v0])).toBe('')
  })

  it('returns formatted label for v0 + v1', () => {
    const label = versionTimelineLabel([v0, v1])
    expect(label).toContain('Andre Clouet')
    expect(label).toContain('Champagne Collet')
    expect(label).toContain('→')
    // Date format: "7 Oct" (en-NZ)
    expect(label).toMatch(/7\s+Oct/)
  })

  it('includes "from <date>" phrasing', () => {
    const label = versionTimelineLabel([v0, v1])
    expect(label).toContain('from')
  })

  it('uses productName when available, falls back to recipeName', () => {
    const recipeV: MappingVersionData = {
      id: 'v2', mappingKey: 'cocktail', posItemName: 'Cocktail',
      effectiveFrom: '2026-10-20',
      mappingType: 'recipe', productId: null, productName: null,
      recipeId: 'r1', recipeName: 'House Margarita',
      servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null,
    }
    const label = versionTimelineLabel([v0, recipeV])
    expect(label).toContain('House Margarita')
  })
})

// ── unlinkBlockedReason ───────────────────────────────────────────────────────

describe('unlinkBlockedReason', () => {
  const v0: MappingVersionData = {
    id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01',
    mappingType: 'product', productId: 'p1', productName: 'Andre Clouet',
    recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
    servingType: null, conversionUnit: null,
  }

  it('returns null when no versions and no load error', () => {
    expect(unlinkBlockedReason([], false)).toBeNull()
  })

  it('returns message when key has versions (unlink disabled)', () => {
    const result = unlinkBlockedReason([v0], false)
    expect(result).not.toBeNull()
    expect(result).toContain('dated product changes')
  })

  it('returns message when versions failed to load (fail-safe)', () => {
    expect(unlinkBlockedReason([], true)).not.toBeNull()
  })
})

// ── saveMappingBlockedReason ──────────────────────────────────────────────────

describe('saveMappingBlockedReason', () => {
  const v0: MappingVersionData = {
    id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01',
    mappingType: 'product', productId: 'p1', productName: 'Andre Clouet',
    recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
    servingType: null, conversionUnit: null,
  }

  it('Save is disabled for a versioned existing mapping', () => {
    expect(saveMappingBlockedReason(true, [v0], false)).not.toBeNull()
  })

  it('Save is disabled when versions are unavailable for an existing mapping', () => {
    expect(saveMappingBlockedReason(true, [], true)).not.toBeNull()
  })

  it('Save is still enabled for a new link when versions are unavailable', () => {
    expect(saveMappingBlockedReason(false, [], true)).toBeNull()
  })

  it('Save is enabled for an unversioned existing mapping with no load error', () => {
    expect(saveMappingBlockedReason(true, [], false)).toBeNull()
  })
})

// ── Two-choice gate ───────────────────────────────────────────────────────────

describe('two-choice gate (saveMappingBlockedReason)', () => {
  const v: MappingVersionData = {
    id: 'v0', mappingKey: 'k', posItemName: 'W', effectiveFrom: '0000-01-01',
    mappingType: 'direct_product', productId: 'p1', productName: 'X',
    recipeId: null, recipeName: null, servingMl: null, conversionRatio: null,
    servingType: null, conversionUnit: null,
  }

  it('blocks Save (fix-mistake) for existing mapping with version history', () => {
    expect(saveMappingBlockedReason(true, [v], false)).not.toBeNull()
  })

  it('does not block Save for new mapping even with versions present', () => {
    expect(saveMappingBlockedReason(false, [v], false)).toBeNull()
  })
})

// ── buildChangeProductBody ────────────────────────────────────────────────────

describe('buildChangeProductBody', () => {
  const product: any = { id: 'p1', name: 'Andre Clouet', size: '750', unit: 'ml' }

  it('builds correct body with each serving', () => {
    const body = buildChangeProductBody('Wine', '2026-10-01', product, 'each', '')
    expect(body.posItemName).toBe('Wine')
    expect(body.effectiveFrom).toBe('2026-10-01')
    expect(body.newFields.productId).toBe('p1')
    expect(body.newFields.productName).toBe('Andre Clouet')
    expect(body.newFields.mappingType).toBe('direct_product')
    expect(body.newFields.conversionUnit).toBe('each')
    expect(body.newFields.recipeId).toBeNull()
    expect(body.newFields.recipeName).toBeNull()
  })

  it('builds body with shot serving', () => {
    const body = buildChangeProductBody('Wine', '2026-10-01', product, 'shot', '')
    expect(body.newFields.servingMl).toBe(30)
    expect(body.newFields.conversionUnit).toBe('ml')
    expect(body.newFields.servingType).toBe('shot')
  })

  it('builds body with custom ml', () => {
    const body = buildChangeProductBody('Wine', '2026-10-01', product, 'custom', '200')
    expect(body.newFields.servingMl).toBe(200)
  })
})

// ── changeProductPreview ──────────────────────────────────────────────────────

describe('changeProductPreview', () => {
  it('builds preview text with old and new product', () => {
    const text = changeProductPreview('2026-10-01', 'Champagne Collet', 'Andre Clouet')
    expect(text).toContain('Champagne Collet')
    expect(text).toContain('Andre Clouet')
    expect(text).toContain('1 Oct 2026')
    expect(text).toMatch(/Sales before.*stay with.*Sales from.*go to/)
  })

  it('returns empty string when no date', () => {
    expect(changeProductPreview('', 'A', 'B')).toBe('')
  })

  it('uses "old product" when oldProductName is null', () => {
    const text = changeProductPreview('2026-10-01', null, 'New Product')
    expect(text).toContain('old product')
    expect(text).toContain('New Product')
  })
})

// ── firstDeliveryDate ─────────────────────────────────────────────────────────

describe('firstDeliveryDate', () => {
  it('picks the earliest date when multiple matches exist', () => {
    const lines = [
      { date: '2026-10-05', productId: 'p1' },
      { date: '2026-09-01', productId: 'p1' },
      { date: '2026-10-01', productId: 'p1' },
    ]
    expect(firstDeliveryDate(lines, 'p1')).toBe('2026-09-01')
  })

  it('returns null when no lines match the productId', () => {
    expect(firstDeliveryDate([{ date: '2026-10-01', productId: 'other' }], 'p1')).toBeNull()
  })

  it('returns null for empty lines array', () => {
    expect(firstDeliveryDate([], 'p1')).toBeNull()
  })

  it('ignores lines with null date', () => {
    const lines = [
      { date: null, productId: 'p1' },
      { date: '2026-10-01', productId: 'p1' },
    ]
    expect(firstDeliveryDate(lines, 'p1')).toBe('2026-10-01')
  })
})

// ── undoConfirmText ───────────────────────────────────────────────────────────

describe('undoConfirmText', () => {
  it('names the v0 product when only one real version', () => {
    const versions: MappingVersionData[] = [
      { id: 'v0', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '0000-01-01', mappingType: 'direct_product', productId: 'p1', productName: 'Collet', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
      { id: 'v1', mappingKey: 'wine', posItemName: 'Wine', effectiveFrom: '2026-10-01', mappingType: 'direct_product', productId: 'p2', productName: 'Andre Clouet', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
    ]
    expect(undoConfirmText(versions)).toContain('Collet')
    expect(undoConfirmText(versions)).toContain('Restore')
  })

  it('names the second-to-last real version when multiple real versions', () => {
    const versions: MappingVersionData[] = [
      { id: 'v0', mappingKey: 'w', posItemName: 'W', effectiveFrom: '0000-01-01', mappingType: 'direct_product', productId: 'p0', productName: 'Original', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
      { id: 'v1', mappingKey: 'w', posItemName: 'W', effectiveFrom: '2026-09-01', mappingType: 'direct_product', productId: 'p1', productName: 'Middle', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
      { id: 'v2', mappingKey: 'w', posItemName: 'W', effectiveFrom: '2026-10-01', mappingType: 'direct_product', productId: 'p2', productName: 'Latest', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
    ]
    expect(undoConfirmText(versions)).toContain('Middle')
  })

  it('falls back to "previous product" when no v0 name', () => {
    const versions: MappingVersionData[] = [
      { id: 'v1', mappingKey: 'w', posItemName: 'W', effectiveFrom: '2026-10-01', mappingType: 'direct_product', productId: 'p2', productName: 'Latest', recipeId: null, recipeName: null, servingMl: null, conversionRatio: null, servingType: null, conversionUnit: null },
    ]
    expect(undoConfirmText(versions)).toContain('previous product')
  })
})

// ── buildStraddleDecisions ────────────────────────────────────────────────────

describe('buildStraddleDecisions', () => {
  function makeReport(id: string): ActiveReport {
    return {
      id, source: 'csv', startStr: '2026-10-01', endStr: '2026-10-07', startMs: 0,
      days: 7, lineCount: 1, totalRevenue: 0, totalQtySold: 5,
      rawLines: [{ name: 'wine', qtySold: 5 }],
      overlappingCycles: [], allocationMethod: 'none', status: null,
    }
  }

  it('returns decisions for reports with defaulted straddle', () => {
    const mockMatch: any = {
      matched: 1, total: 1, matchedRevenue: 0, matchedQty: 1,
      matches: [{
        name: 'wine',
        qtySold: 5,
        mappingStraddle: { versionIds: ['v0', 'v1'], chosenVersionId: 'v0', defaulted: true },
      }],
    }
    const reports = [makeReport('r1')]
    const result = buildStraddleDecisions({ r1: mockMatch }, reports)
    expect(result).toHaveLength(1)
    expect(result[0].reportId).toBe('r1')
    expect(result[0].mappingKey).toBe('wine')
    expect(result[0].versionIds).toEqual(['v0', 'v1'])
    expect(result[0].chosenVersionId).toBe('v0')
    expect(result[0].period).toBe('2026-10-01 – 2026-10-07')
  })

  it('ignores non-defaulted straddle (user already decided)', () => {
    const mockMatch: any = {
      matched: 1, total: 1, matchedRevenue: 0, matchedQty: 1,
      matches: [{
        name: 'wine',
        mappingStraddle: { versionIds: ['v0', 'v1'], chosenVersionId: 'v1', defaulted: false },
      }],
    }
    const reports = [makeReport('r1')]
    expect(buildStraddleDecisions({ r1: mockMatch }, reports)).toHaveLength(0)
  })

  it('ignores matches with no straddle data', () => {
    const mockMatch: any = {
      matched: 1, total: 1, matchedRevenue: 0, matchedQty: 1,
      matches: [{ name: 'wine', qtySold: 5 }],
    }
    const reports = [makeReport('r1')]
    expect(buildStraddleDecisions({ r1: mockMatch }, reports)).toHaveLength(0)
  })

  it('returns empty for no reports', () => {
    expect(buildStraddleDecisions({}, [])).toHaveLength(0)
  })

  it('deduplicates by (reportId, mappingKey)', () => {
    const mockMatch: any = {
      matched: 2, total: 2, matchedRevenue: 0, matchedQty: 2,
      matches: [
        { name: 'wine', qtySold: 3, mappingStraddle: { versionIds: ['v0', 'v1'], chosenVersionId: 'v0', defaulted: true } },
        { name: 'wine', qtySold: 2, mappingStraddle: { versionIds: ['v0', 'v1'], chosenVersionId: 'v0', defaulted: true } },
      ],
    }
    const reports = [makeReport('r1')]
    const result = buildStraddleDecisions({ r1: mockMatch }, reports)
    expect(result).toHaveLength(1)
  })
})
