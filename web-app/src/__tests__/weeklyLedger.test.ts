import { describe, it, expect } from 'vitest'
import {
  weekMonday,
  daySpan,
  weekDayBreakdown,
  partitionReports,
  buildStrip,
  buildVelocityRowsFromReports,
  buildUnmatchedRows,
  normName,
  isSquareSource,
  normaliseSalesReport,
  type ActiveReport,
  type MatchData,
  type StockEntry,
} from '../utils/weeklyLedger'

// ── weekMonday ─────────────────────────────────────────────────────────────────

describe('weekMonday', () => {
  it('Monday → itself', () => expect(weekMonday('2026-09-28')).toBe('2026-09-28'))
  it('Sunday → previous Monday', () => expect(weekMonday('2026-10-04')).toBe('2026-09-28'))
  it('Wednesday → that week Monday', () => expect(weekMonday('2026-09-30')).toBe('2026-09-28'))
  it('Tuesday → that week Monday', () => expect(weekMonday('2026-09-29')).toBe('2026-09-28'))
})

// ── daySpan ────────────────────────────────────────────────────────────────────

describe('daySpan', () => {
  it('same day = 1', () => expect(daySpan('2026-09-28', '2026-09-28')).toBe(1))
  it('Mon–Sun = 7', () => expect(daySpan('2026-09-28', '2026-10-04')).toBe(7))
  it('Mon–Tue = 2', () => expect(daySpan('2026-09-28', '2026-09-29')).toBe(2))
})

// ── weekDayBreakdown ───────────────────────────────────────────────────────────

describe('weekDayBreakdown', () => {
  it('Tue–Mon report spanning two calendar weeks splits days correctly', () => {
    // Tue 29 Sep → Mon 5 Oct 2026 (7 days)
    // Week of Mon 28 Sep: Tue 29, Wed 30, Thu 1, Fri 2, Sat 3, Sun 4 = 6 days
    // Week of Mon 5 Oct:  Mon 5                                       = 1 day
    const result = weekDayBreakdown('2026-09-29', '2026-10-05')
    expect(result['2026-09-28']).toBe(6) // Tue–Sun of that week
    expect(result['2026-10-05']).toBe(1) // Mon only
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('full Mon–Sun covers exactly one week', () => {
    const result = weekDayBreakdown('2026-09-28', '2026-10-04')
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['2026-09-28']).toBe(7)
  })
})

// ── partitionReports ──────────────────────────────────────────────────────────

function makeDoc(id: string, status: string | undefined, start: string | null, end: string | null): { id: string; data(): any } {
  return {
    id,
    data: () => ({
      status,
      periodStart: start ? { toDate: () => new Date(start + 'T00:00:00Z'), toMillis: () => new Date(start + 'T00:00:00Z').getTime() } : null,
      periodEnd:   end   ? { toDate: () => new Date(end   + 'T00:00:00Z'), toMillis: () => new Date(end   + 'T00:00:00Z').getTime() } : null,
      report: {
        period: { start, end },
        lines: [],
      },
      source: 'csv',
    }),
  }
}

describe('partitionReports', () => {
  it('active (no status) report is included', () => {
    const { reports } = partitionReports([makeDoc('r1', undefined, '2026-09-01', '2026-09-07')])
    expect(reports).toHaveLength(1)
    expect(reports[0].id).toBe('r1')
  })

  it('superseded report is excluded, counted', () => {
    const { reports, inactiveCount } = partitionReports([
      makeDoc('r1', 'active',     '2026-09-01', '2026-09-07'),
      makeDoc('r2', 'superseded', '2026-09-01', '2026-09-07'),
    ])
    expect(reports).toHaveLength(1)
    expect(inactiveCount).toBe(1)
  })

  it('voided report is excluded, counted', () => {
    const { reports, inactiveCount } = partitionReports([
      makeDoc('r1', 'active', '2026-09-01', '2026-09-07'),
      makeDoc('r2', 'voided', '2026-09-01', '2026-09-07'),
    ])
    expect(reports).toHaveLength(1)
    expect(inactiveCount).toBe(1)
  })

  it('report with no start date goes to prePeriod', () => {
    const { reports, prePeriod } = partitionReports([makeDoc('r1', 'active', null, null)])
    expect(reports).toHaveLength(0)
    expect(prePeriod).toHaveLength(1)
  })

  it('sorts active reports ascending by periodStart', () => {
    const { reports } = partitionReports([
      makeDoc('newer', 'active', '2026-10-01', '2026-10-07'),
      makeDoc('older', 'active', '2026-09-01', '2026-09-07'),
    ])
    expect(reports[0].id).toBe('older')
    expect(reports[1].id).toBe('newer')
  })
})

// ── buildVelocityRowsFromReports ──────────────────────────────────────────────

function makeReport(id: string, start: string, end: string, lines: any[] = []): ActiveReport {
  return {
    id, source: 'csv', startStr: start, endStr: end,
    startMs: new Date(start + 'T00:00:00Z').getTime(),
    days: daySpan(start, end),
    lineCount: lines.length, totalRevenue: 0, totalQtySold: 0,
    rawLines: lines, overlappingCycles: [], allocationMethod: 'none', status: 'active',
  }
}

function makeMatches(id: string, matches: Array<{ productId: string; name: string; qtySold: number; gross: number }>): MatchData {
  return {
    matched: matches.length, total: matches.length,
    matchedRevenue: matches.reduce((s, m) => s + m.gross, 0),
    matchedQty: matches.reduce((s, m) => s + m.qtySold, 0),
    matches,
  }
}

describe('buildVelocityRowsFromReports — day-weighting and status', () => {
  const stockMap: Record<string, StockEntry> = {}

  it('Tue–Mon report spanning two weeks distributes units by day-weight', () => {
    // anchorMon = Oct 12 (todayNZ Oct 20, currentWeekMon Oct 19, anchorMon Oct 12)
    // last4 = [Sep 21, Sep 28, Oct 5, Oct 12]
    // Sep 28 week: 6 days (Tue-Sun); Oct 5 week: 1 day (Mon) → total last4Units = 7
    const report = makeReport('r1', '2026-09-29', '2026-10-05')
    const matches = makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 7, gross: 70 }])
    const todayNZ = '2026-10-20'
    const { rows } = buildVelocityRowsFromReports([report], { r1: matches }, stockMap, todayNZ)
    expect(rows).toHaveLength(1)
    expect(rows[0].last4Units).toBeCloseTo(7, 0)
    expect(rows[0].name).toBe('Beer')
  })

  it('voided report is not in results when excluded by caller', () => {
    const active = makeReport('r1', '2026-09-01', '2026-09-07')
    const voided = makeReport('r2', '2026-09-08', '2026-09-14')
    const mActive = makeMatches('r1', [{ productId: 'p1', name: 'Wine', qtySold: 10, gross: 100 }])
    const mVoided = makeMatches('r2', [{ productId: 'p1', name: 'Wine', qtySold: 100, gross: 1000 }])
    const { rows } = buildVelocityRowsFromReports([active], { r1: mActive, r2: mVoided }, stockMap, '2026-10-20')
    expect(rows).toHaveLength(1)
    expect(rows[0].last4Units + rows[0].prev4Units).toBeLessThanOrEqual(10 + 1)
  })

  it('Tue-Mon report Monday spill into current week is ignored', () => {
    // todayNZ = Oct 12 (Mon), anchorMon = Oct 5
    // Report Tue Oct 6 to Mon Oct 12 (7 days); Oct 12 is current week → excluded
    // Only 6/7 of units in Oct 5 week
    const report = makeReport('r1', '2026-10-06', '2026-10-12')
    const { rows } = buildVelocityRowsFromReports(
      [report],
      { r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 7, gross: 70 }]) },
      {},
      '2026-10-12',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].last4Units).toBeCloseTo(6, 1)
  })

  it('coverage < 14 days in last4 → No recent data status', () => {
    // anchorMon = Oct 12 (todayNZ Oct 19). 7-day report in anchor week only → 7 covered days < 14
    const report = makeReport('r1', '2026-10-12', '2026-10-18')
    const { rows } = buildVelocityRowsFromReports(
      [report],
      { r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 10, gross: 100 }]) },
      {},
      '2026-10-19',
    )
    expect(rows[0].status).toBe('No recent data')
  })

  it('missing week inside last4 with < 14 covered days → No recent data, not Slowing/Stagnant', () => {
    // todayNZ = Oct 12, anchorMon = Oct 5, last4 = [Sep 14, Sep 21, Sep 28, Oct 5]
    // Only Sep 28 week covered (7 days) → last4CoveredDays = 7 < 14
    const prevReport = makeReport('r0', '2026-08-17', '2026-09-13')
    const lastReport = makeReport('r1', '2026-09-28', '2026-10-04')
    const { rows } = buildVelocityRowsFromReports(
      [prevReport, lastReport],
      {
        r0: makeMatches('r0', [{ productId: 'p1', name: 'Beer', qtySold: 40, gross: 400 }]),
        r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 2, gross: 20 }]),
      },
      {},
      '2026-10-12',
    )
    expect(rows[0].status).toBe('No recent data')
  })

  it('partial anchor week coverage uses rate when total last4 >= 14 days', () => {
    // todayNZ = Oct 12, anchorMon = Oct 5, last4 = [Sep 14, Sep 21, Sep 28, Oct 5]
    // r1: Sep 14-27 (14 days); r2: Oct 5-7 (3 days partial anchor)
    // last4CoveredDays = 14 + 3 = 17 >= 14 → changePct is not null
    const r0 = makeReport('r0', '2026-08-17', '2026-09-13') // 28 days, prev4
    const r1 = makeReport('r1', '2026-09-14', '2026-09-27') // 14 days, Sep 14 + Sep 21 weeks
    const r2 = makeReport('r2', '2026-10-05', '2026-10-07') // 3 days, partial anchor
    const { rows } = buildVelocityRowsFromReports(
      [r0, r1, r2],
      {
        r0: makeMatches('r0', [{ productId: 'p1', name: 'Beer', qtySold: 28, gross: 280 }]),
        r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 14, gross: 140 }]),
        r2: makeMatches('r2', [{ productId: 'p1', name: 'Beer', qtySold: 3, gross: 30 }]),
      },
      {},
      '2026-10-12',
    )
    expect(rows[0].changePct).not.toBeNull()
  })

  it('weeksSinceLastSale = 0 when last sale in anchor week', () => {
    // todayNZ = Oct 12, anchorMon = Oct 5; report covers anchor week exactly
    const { rows } = buildVelocityRowsFromReports(
      [makeReport('r1', '2026-10-05', '2026-10-11')],
      { r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 5, gross: 50 }]) },
      {},
      '2026-10-12',
    )
    expect(rows[0].weeksSinceLastSale).toBe(0)
  })

  it('weeksSinceLastSale counts calendar weeks back from anchor (gap case)', () => {
    // todayNZ = Oct 19, anchorMon = Oct 12; last sale Aug 17 = 8 weeks before anchor
    const { rows } = buildVelocityRowsFromReports(
      [makeReport('r1', '2026-08-17', '2026-08-23')],
      { r1: makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 5, gross: 50 }]) },
      {},
      '2026-10-19',
    )
    expect(rows[0].weeksSinceLastSale).toBe(8)
  })

  describe('status precedence', () => {
    function velocityStatus(last4: number, prev4: number, stock: number | null): string {
      const stock2: Record<string, StockEntry> = stock != null ? { p1: { count: stock, cycleNumber: 1 } } : {}
      // todayNZ = Oct 19 (Mon), anchorMon = Oct 12
      // prev4 = [Aug 24, Aug 31, Sep 7, Sep 14]; last4 = [Sep 21, Sep 28, Oct 5, Oct 12]
      const weeks = [
        '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', // prev4
        '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', // last4
      ]
      const reports = weeks.map((w, i) => makeReport(`r${i}`, w, new Date(new Date(w + 'T00:00:00Z').getTime() + 6 * 86_400_000).toISOString().slice(0, 10)))
      const matchMap: Record<string, MatchData> = {}
      weeks.forEach((w, i) => {
        const isPrev4 = i < 4
        const qty = isPrev4 ? Math.round(prev4 / 4) : Math.round(last4 / 4)
        matchMap[`r${i}`] = makeMatches(`r${i}`, [{ productId: 'p1', name: 'Beer', qtySold: qty, gross: qty * 10 }])
      })
      const { rows } = buildVelocityRowsFromReports(reports, matchMap, stock2, '2026-10-19')
      return rows[0]?.status ?? 'none'
    }

    it('stock === 0 → Sold out regardless of units', () => {
      expect(velocityStatus(10, 5, 0)).toBe('Sold out')
    })

    it('last4 = 0, had sales before → Stagnant', () => {
      expect(velocityStatus(0, 8, 5)).toBe('Stagnant')
    })

    it('prev4 = 8, last4 < 75% of prev4 (threshold: 75%) → Slowing', () => {
      // last4 = 5 → round(5/4)=1/wk → last4Units=4; prev4 = 8 → round(8/4)=2/wk → prev4Units=8
      // rate: 4/28 < 0.75 * 8/28 → Slowing
      expect(velocityStatus(5, 8, 5)).toBe('Slowing')
    })

    it('prev4 = 8, last4 >= 75% of prev4 → Selling', () => {
      // last4 = 6 → round(6/4)=2/wk → last4Units=8; same rate as prev4 → Selling
      expect(velocityStatus(6, 8, 5)).toBe('Selling')
    })

    it('prev4 < 8 → Slowing threshold not applied even when last4 < prev4', () => {
      expect(velocityStatus(4, 4, 5)).toBe('Selling')
    })
  })
})

// ── buildStrip ────────────────────────────────────────────────────────────────

describe('buildStrip', () => {
  function makeStripReport(id: string, start: string, end: string, status: string = 'active'): ActiveReport {
    return {
      ...makeReport(id, start, end),
      status,
    }
  }

  const TODAY = '2026-10-12' // Monday; anchorMon = Oct 5; strip runs Oct 12 back 25 weeks

  it('active report covering all 7 days of a week → present', () => {
    const r = makeStripReport('r1', '2026-10-05', '2026-10-11') // Mon-Sun
    const strip = buildStrip([r], TODAY)
    const cell = strip.find(c => c.monday === '2026-10-05')!
    expect(cell.state).toBe('present')
  })

  it('active+voided same week = partial when active covers 6 days', () => {
    const active = makeStripReport('r1', '2026-10-05', '2026-10-10') // Mon-Sat (6 days)
    const voided = makeStripReport('r2', '2026-10-06', '2026-10-11', 'voided') // Tue-Sun
    const strip = buildStrip([active, voided], TODAY)
    const cell = strip.find(c => c.monday === '2026-10-05')!
    expect(cell.state).toBe('partial')
  })

  it('two overlapping active reports do not double-count — union = 7 → present', () => {
    const r1 = makeStripReport('r1', '2026-10-05', '2026-10-08') // Mon-Thu (4 days)
    const r2 = makeStripReport('r2', '2026-10-07', '2026-10-11') // Wed-Sun (5 days)
    const strip = buildStrip([r1, r2], TODAY)
    const cell = strip.find(c => c.monday === '2026-10-05')!
    expect(cell.state).toBe('present')
  })

  it('voided-only week = voided', () => {
    const r = makeStripReport('r1', '2026-09-28', '2026-10-04', 'voided') // Mon-Sun
    const strip = buildStrip([r], TODAY)
    const cell = strip.find(c => c.monday === '2026-09-28')!
    expect(cell.state).toBe('voided')
  })

  it('consecutive Tue-Mon reports fill a Mon-Sun week = present', () => {
    // Week Mon Sep 28 – Sun Oct 4
    // Report 1 ends Mon Sep 28 (1 day overlap); Report 2 starts Tue Sep 29 (6 days overlap)
    const r1 = makeStripReport('r1', '2026-09-22', '2026-09-28') // ends Mon Sep 28
    const r2 = makeStripReport('r2', '2026-09-29', '2026-10-05') // starts Tue Sep 29
    const strip = buildStrip([r1, r2], TODAY)
    const cell = strip.find(c => c.monday === '2026-09-28')!
    expect(cell.state).toBe('present')
  })

  it('superseded report adds nothing — week stays missing', () => {
    const r = makeStripReport('r1', '2026-10-05', '2026-10-11', 'superseded')
    const strip = buildStrip([r], TODAY)
    const cell = strip.find(c => c.monday === '2026-10-05')!
    expect(cell.state).toBe('missing')
  })

  it('strip always has exactly 26 cells', () => {
    expect(buildStrip([], TODAY)).toHaveLength(26)
  })
})

// ── buildUnmatchedRows ────────────────────────────────────────────────────────

describe('buildUnmatchedRows', () => {
  function makeActiveReport(id: string, lines: { name: string; qtySold: number; grossIncl?: number }[]): ActiveReport {
    return {
      id, source: 'csv',
      startStr: '2026-09-01', endStr: '2026-09-07',
      startMs: 0, days: 7,
      lineCount: lines.length,
      totalRevenue: lines.reduce((s, l) => s + (l.grossIncl ?? 0), 0),
      totalQtySold: lines.reduce((s, l) => s + l.qtySold, 0),
      rawLines: lines.map(l => ({ name: l.name, qtySold: l.qtySold, grossIncl: l.grossIncl ?? null, gross: l.grossIncl ?? null, netExcl: null, net: null, category: null })),
      overlappingCycles: [], allocationMethod: 'none', status: 'active',
      meta: { lineTotalsBasis: 'line_total' },
    }
  }

  it('groups unmatched lines by normalised name across reports', () => {
    const r1 = makeActiveReport('r1', [
      { name: 'Heineken', qtySold: 10, grossIncl: 100 },
      { name: 'Matched Item', qtySold: 5 },
    ])
    const r2 = makeActiveReport('r2', [
      { name: 'Heineken', qtySold: 8, grossIncl: 80 },
    ])
    const matches: Record<string, MatchData> = {
      r1: makeMatches('r1', [{ productId: 'p1', name: 'Matched Item', qtySold: 5, gross: 0 }]),
      r2: { matched: 0, total: 1, matchedRevenue: 0, matchedQty: 0, matches: [] },
    }
    const rows = buildUnmatchedRows([r1, r2], matches)
    expect(rows).toHaveLength(1)
    expect(rows[0].normalisedName).toBe('heineken')
    expect(rows[0].totalQty).toBe(18)
    expect(rows[0].reportCount).toBe(2)
  })

  it('normalises whitespace and case', () => {
    expect(normName('  Heineken  ')).toBe('heineken')
    expect(normName('Mac\'s  Gold')).toBe("mac's gold")
    expect(normName(null)).toBe('')
  })

  it('sorts by units descending', () => {
    const r = makeActiveReport('r1', [
      { name: 'A', qtySold: 3 },
      { name: 'B', qtySold: 10 },
      { name: 'C', qtySold: 1 },
    ])
    const rows = buildUnmatchedRows([r], { r1: makeMatches('r1', []) })
    expect(rows[0].normalisedName).toBe('b')
    expect(rows[1].normalisedName).toBe('a')
    expect(rows[2].normalisedName).toBe('c')
  })

  it('excludes reports with null match doc (F3 — matching run not completed)', () => {
    const r = makeActiveReport('r1', [{ name: 'Ghost', qtySold: 5, grossIncl: 50 }])
    const rows = buildUnmatchedRows([r], { r1: null })
    expect(rows).toHaveLength(0)
  })
})

// ── isSquareSource ─────────────────────────────────────────────────────────────

describe('isSquareSource', () => {
  it('returns true for square-prefixed id', () =>
    expect(isSquareSource('square-abc', undefined)).toBe(true))
  it('returns true for source=square', () =>
    expect(isSquareSource('report-123', 'square')).toBe(true))
  it('returns true for source=square-pull', () =>
    expect(isSquareSource('report-123', 'square-pull')).toBe(true))
  it('returns true for source=square-webhook', () =>
    expect(isSquareSource('sq-1', 'square-webhook')).toBe(true))
  it('returns false for non-Square CSV import', () =>
    expect(isSquareSource('report-abc', 'bustle')).toBe(false))
  it('returns false for undefined source with non-square id', () =>
    expect(isSquareSource('report-abc', undefined)).toBe(false))
})

// ── normaliseSalesReport ───────────────────────────────────────────────────────

describe('normaliseSalesReport', () => {
  it('normalises a Square daily doc', () => {
    const n = normaliseSalesReport('square-abc', {
      source: 'square',
      date:   '2026-09-28',
      lines:  [{ name: 'Beer', qtySold: 5, grossIncl: 575 }],
    })
    expect(n.sourceFormat).toBe('square')
    expect(n.startStr).toBe('2026-09-28')
    expect(n.endStr).toBe('2026-09-28')
    expect(n.days).toBe(1)
    expect(n.lineTotalsBasis).toBe('line_total')
    expect(n.gstBasis).toBe('assumed_incl')
    expect(n.rawLines).toHaveLength(1)
  })

  it('normalises a CSV import doc', () => {
    const n = normaliseSalesReport('r-csv', {
      source: 'bustle',
      report: {
        period: { start: '2026-09-22', end: '2026-09-28' },
        lines:  [{ name: 'Beer', qtySold: 3, grossIncl: 345, netExcl: 300 }],
        meta:   { sourceFormat: 'bustle_rich', lineTotalsBasis: 'line_total', gstBasis: 'explicit' },
      },
    })
    expect(n.sourceFormat).toBe('bustle_rich')
    expect(n.lineTotalsBasis).toBe('line_total')
    expect(n.gstBasis).toBe('explicit')
  })

  it('legacy doc (no meta) gets unknown basis', () => {
    const n = normaliseSalesReport('old', {
      source: 'bustle',
      report: { lines: [{ name: 'Beer', qtySold: 2 }] },
    })
    expect(n.lineTotalsBasis).toBe('unknown')
    expect(n.gstBasis).toBe('unknown')
  })
})

// ── buildStrip with Square daily docs ─────────────────────────────────────────

function makeSquareActiveReport(id: string, date: string): ActiveReport {
  return {
    id,
    source:            'square',
    startStr:          date,
    endStr:            date,
    startMs:           new Date(date + 'T00:00:00Z').getTime(),
    days:              1,
    lineCount:         1,
    totalRevenue:      100,
    totalQtySold:      5,
    rawLines:          [{ name: 'Beer', qtySold: 5, grossIncl: 115 }],
    overlappingCycles: [],
    allocationMethod:  'none',
    status:            null,
    meta:              { sourceFormat: 'square', lineTotalsBasis: 'line_total', gstBasis: 'assumed_incl' },
  }
}

describe('buildStrip with Square docs', () => {
  it('week with 3 Square daily docs shows partial coverage', () => {
    const docs = [
      makeSquareActiveReport('sq-1', '2026-09-28'),  // Mon
      makeSquareActiveReport('sq-2', '2026-09-29'),  // Tue
      makeSquareActiveReport('sq-3', '2026-09-30'),  // Wed
    ]
    const strip = buildStrip(docs, '2026-10-13')
    const wk = strip.find(c => c.monday === '2026-09-28')
    expect(wk?.state).toBe('partial')
  })

  it('week with 7 Square daily docs shows present', () => {
    const dates = ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']
    const docs = dates.map((d, i) => makeSquareActiveReport(`sq-${i}`, d))
    const strip = buildStrip(docs, '2026-10-13')
    const wk = strip.find(c => c.monday === '2026-09-28')
    expect(wk?.state).toBe('present')
  })
})

// ── canVoidReport (via isSquareSource) ────────────────────────────────────────

describe('Void hidden for Square-sourced reports', () => {
  it('isSquareSource is true for Square doc → cannot void', () => {
    const squareReport = makeSquareActiveReport('sq-1', '2026-09-28')
    expect(isSquareSource(squareReport.id, squareReport.source)).toBe(true)
  })

  it('isSquareSource is false for CSV import id/source → can void', () => {
    expect(isSquareSource('report-bustle-abc', 'bustle')).toBe(false)
  })
})
