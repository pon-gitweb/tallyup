import { describe, it, expect } from 'vitest'
import { periodFromFilename } from '../utils/periodFromFilename'

describe('periodFromFilename', () => {
  it('parses standard Bustle GP report filename', () => {
    expect(periodFromFilename('gp-on-items-moved_28Sep26-04Oct26.csv')).toEqual({
      start: '2026-09-28',
      end:   '2026-10-04',
    })
  })

  it('parses with (1) suffix', () => {
    expect(periodFromFilename('gp-on-items-moved_28Sep26-04Oct26 (1).csv')).toEqual({
      start: '2026-09-28',
      end:   '2026-10-04',
    })
  })

  it('parses sales_ prefix', () => {
    expect(periodFromFilename('sales_01Jan25-07Jan25.csv')).toEqual({
      start: '2025-01-01',
      end:   '2025-01-07',
    })
  })

  it('parses items-moved_ prefix', () => {
    expect(periodFromFilename('items-moved_15Mar25-21Mar25.csv')).toEqual({
      start: '2025-03-15',
      end:   '2025-03-21',
    })
  })

  it('returns null for a filename with no date pattern', () => {
    expect(periodFromFilename('my-sales-data.csv')).toBeNull()
  })

  it('returns null for an invalid month abbreviation', () => {
    expect(periodFromFilename('sales_01Abc25-07Abc25.csv')).toBeNull()
  })

  it('returns null for an impossible day (day 32)', () => {
    expect(periodFromFilename('sales_32Jan25-07Jan25.csv')).toBeNull()
  })

  it('handles month boundary correctly (31 Oct → valid)', () => {
    expect(periodFromFilename('sales_25Oct26-31Oct26.csv')).toEqual({
      start: '2026-10-25',
      end:   '2026-10-31',
    })
  })

  it('returns null for February 30 (invalid date)', () => {
    expect(periodFromFilename('sales_28Feb25-30Feb25.csv')).toBeNull()
  })

  it('returns null when end date is before start date', () => {
    expect(periodFromFilename('sales_07Sep26-01Sep26.csv')).toBeNull()
  })

  it('second file always returns its own dates (overwrites first)', () => {
    const first  = periodFromFilename('sales_01Sep26-07Sep26.csv')!
    const second = periodFromFilename('sales_08Sep26-14Sep26.csv')!
    expect(first.start).toBe('2026-09-01')
    expect(second.start).toBe('2026-09-08') // new file's dates, not carried from first
    expect(second.end).toBe('2026-09-14')
  })
})
