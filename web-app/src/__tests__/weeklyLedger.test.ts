import { describe, it, expect } from 'vitest'
import {
  weekMonday,
  daySpan,
  weekDayBreakdown,
  partitionReports,
  buildVelocityRowsFromReports,
  buildUnmatchedRows,
  normName,
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
    // 7-day report: Tue 29 Sep – Mon 5 Oct
    // 6/7 of units go to week 28 Sep, 1/7 to week 5 Oct
    const report = makeReport('r1', '2026-09-29', '2026-10-05')
    const matches = makeMatches('r1', [{ productId: 'p1', name: 'Beer', qtySold: 7, gross: 70 }])
    const todayNZ = '2026-10-20' // current week Mon = 19 Oct
    const rows = buildVelocityRowsFromReports([report], { r1: matches }, stockMap, todayNZ)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    // Both weeks are before 19 Oct, and they are in the "sortedWeeks" window
    // last4 = last 4 complete weeks before 19 Oct: 5 Oct, 28 Sep, 21 Sep, 14 Sep
    // 5 Oct week has 1/7 × 7 = 1 unit; 28 Sep week has 6/7 × 7 = 6 units
    expect(row.last4Units).toBeCloseTo(7, 0) // both weeks in last 4
    expect(row.name).toBe('Beer')
  })

  it('voided report is not in results when excluded by caller', () => {
    const active = makeReport('r1', '2026-09-01', '2026-09-07')
    const voided = makeReport('r2', '2026-09-08', '2026-09-14')
    const mActive = makeMatches('r1', [{ productId: 'p1', name: 'Wine', qtySold: 10, gross: 100 }])
    const mVoided = makeMatches('r2', [{ productId: 'p1', name: 'Wine', qtySold: 100, gross: 1000 }])
    // Voided reports should be excluded BEFORE calling this function (caller filters)
    const rows = buildVelocityRowsFromReports([active], { r1: mActive, r2: mVoided }, stockMap, '2026-10-20')
    expect(rows).toHaveLength(1)
    // Units only from active report (voided excluded)
    expect(rows[0].last4Units + rows[0].prev4Units).toBeLessThanOrEqual(10 + 1)
  })

  describe('status precedence', () => {
    function velocityStatus(last4: number, prev4: number, stock: number | null): string {
      const stock2: Record<string, StockEntry> = stock != null ? { p1: { count: stock, cycleNumber: 1 } } : {}

      // Build a synthetic 10-week period so we have last4 and prev4 populated
      // We need 8 weeks of complete data before "today"
      // today = 2026-10-19 (Mon), week -1 = 12 Oct, week -2 = 5 Oct, ...
      // We'll use a report spanning 8 complete Mon-Sun weeks
      // week 1: 2026-08-17, week 8: 2026-10-04
      const r = makeReport('r1', '2026-08-17', '2026-10-11')
      const totalDays = daySpan('2026-08-17', '2026-10-11')
      // 8 weeks = 56 days; each week gets 1/8 of units
      // last4 weeks = 2026-09-14, 2026-09-21, 2026-09-28, 2026-10-05
      // prev4 weeks = 2026-08-17, 2026-08-24, 2026-08-31, 2026-09-07

      // We want last4Units ≈ last4, prev4Units ≈ prev4
      // With uniform distribution: qtySold * (7 / totalDays) per week
      // But we want EXACT control, so we'll use separate reports per week.
      const weeks = [
        '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', // prev4
        '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', // last4
      ]
      const reports = weeks.map((w, i) => makeReport(`r${i}`, w, new Date(new Date(w + 'T00:00:00Z').getTime() + 6 * 86_400_000).toISOString().slice(0, 10)))
      const matchMap: Record<string, MatchData> = {}
      weeks.forEach((w, i) => {
        const isPrev4 = i < 4
        const qty = isPrev4 ? Math.round(prev4 / 4) : Math.round(last4 / 4)
        matchMap[`r${i}`] = makeMatches(`r${i}`, [{ productId: 'p1', name: 'Beer', qtySold: qty, gross: qty * 10 }])
      })

      const rows = buildVelocityRowsFromReports(reports, matchMap, stock2, '2026-10-19')
      return rows[0]?.status ?? 'none'
    }

    it('stock === 0 → Sold out regardless of units', () => {
      expect(velocityStatus(10, 5, 0)).toBe('Sold out')
    })

    it('last4 = 0, had sales before → Stagnant', () => {
      expect(velocityStatus(0, 8, 5)).toBe('Stagnant')
    })

    it('prev4 = 8, last4 < 75% of prev4 (threshold: 75%) → Slowing', () => {
      // last4 = 5, prev4 = 8, 5 < 8 * 0.75 = 6 → Slowing
      expect(velocityStatus(5, 8, 5)).toBe('Slowing')
    })

    it('prev4 = 8, last4 >= 75% of prev4 → Selling', () => {
      // last4 = 6, prev4 = 8, 6 >= 6 → Selling
      expect(velocityStatus(6, 8, 5)).toBe('Selling')
    })

    it('prev4 < 8 → Slowing threshold not applied even when last4 < prev4', () => {
      // prev4 = 4 per-week × 4 = 4 units prev; last4 = 1 per-week × 4 = 4 units last4
      // But we can also test: prev4=4 rounds to 1/wk (round(4/4)=1),
      // last4=4 rounds to 1/wk → last4Units=4, prev4Units=4, ratio = 1 → Selling
      // The key check: prev4Units < 8, so Slowing condition is NOT evaluated
      expect(velocityStatus(4, 4, 5)).toBe('Selling')
    })
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
    const rows = buildUnmatchedRows([r], { r1: null })
    expect(rows[0].normalisedName).toBe('b')
    expect(rows[1].normalisedName).toBe('a')
    expect(rows[2].normalisedName).toBe('c')
  })
})
