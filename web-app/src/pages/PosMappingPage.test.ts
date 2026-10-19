import { describe, it, expect, vi } from 'vitest'
import {
  buildNotLinkedRows,
  buildNoServingRows,
  servingPreviewText,
  buildSavePayload,
  rematchReports,
  type NoServingRow,
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
    // Both src/utils/mappingId.ts and web-app/src/utils/mappingId.ts are kept in sync
    // by check-mappingid-sync.js — this test guards the logic directly.
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
    // servingPreviewText is only called for ml-based servings
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

  function makeMatchData(matches: { name: string; productId: string; productName: string; qtySold: number; conversionSource: string }[]): MatchData {
    return {
      matched: matches.length, total: matches.length, matchedQty: 0, matchedRevenue: 0,
      matches: matches.map(m => ({ name: m.name, productId: m.productId, productName: m.productName, qtySold: m.qtySold, conversionSource: m.conversionSource })),
    }
  }

  it('returns rows with conversionSource === default', () => {
    const report = makeReport('r1', [{ name: 'House Red', qtySold: 10 }])
    const md = makeMatchData([{ name: 'House Red', productId: 'p1', productName: 'Chateau Rouge', qtySold: 10, conversionSource: 'default' }])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(1)
    expect(rows[0].posName).toBe('House Red')
    expect(rows[0].productId).toBe('p1')
    expect(rows[0].totalQty).toBe(10)
  })

  it('excludes rows with conversionSource !== default', () => {
    const report = makeReport('r1', [{ name: 'Heineken', qtySold: 5 }])
    const md = makeMatchData([{ name: 'Heineken', productId: 'p2', productName: 'Heineken 330ml', qtySold: 5, conversionSource: 'servingMl' }])
    const rows = buildNoServingRows([report], { r1: md })
    expect(rows).toHaveLength(0)
  })

  it('aggregates qty across multiple reports for same name', () => {
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
    // No undefined anywhere in the payload
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
    // progress called once per report
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
