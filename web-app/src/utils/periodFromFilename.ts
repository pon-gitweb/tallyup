/**
 * Parse a Bustle sales export filename into a {start, end} period.
 *
 * Matches patterns like:
 *   gp-on-items-moved_28Sep26-04Oct26.csv
 *   sales_28Sep26-04Oct26 (1).csv
 *   items-moved_28Sep26-04Oct26.csv
 *
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } or null for no match /
 * invalid dates.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const DATE_RE = /_(\d{2})([A-Za-z]{3})(\d{2})-(\d{2})([A-Za-z]{3})(\d{2})/

function parseDate(day: string, mon: string, yr: string): string | null {
  const m = MONTHS[mon.toLowerCase()]
  if (!m) return null
  const d = parseInt(day, 10)
  const y = 2000 + parseInt(yr, 10)
  if (d < 1 || d > 31 || y < 2020 || y > 2099) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function periodFromFilename(filename: string): { start: string; end: string } | null {
  const m = DATE_RE.exec(filename)
  if (!m) return null
  const start = parseDate(m[1], m[2], m[3])
  const end   = parseDate(m[4], m[5], m[6])
  if (!start || !end) return null
  if (end < start) return null
  return { start, end }
}
