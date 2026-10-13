/**
 * Content-hash helpers for sales CSV deduplication.
 *
 * salesFileHash  – current hash: covers every parsed line (name, qty, gross, net).
 *                  Used as the processedSalesReports doc id and report.meta.fileHash.
 *
 * legacySalesHash – old hash: line count + first 5 names.
 *                   Checked at import time so previously-imported files are still caught.
 *                   Never written for new imports.
 */

type MinLine = { name: string; qtySold: number; gross?: number | null; net?: number | null }

function djb2(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = Math.imul(h, 33) ^ str.charCodeAt(i)
  return (h >>> 0).toString(36)
}

export function salesFileHash(lines: MinLine[]): string {
  const body = lines
    .map(l => [
      (l.name ?? '').toLowerCase().trim(),
      l.qtySold,
      l.gross ?? '',
      l.net ?? '',
    ].join('|'))
    .join('\n')
  return djb2(`${lines.length}\n${body}`)
}

export function legacySalesHash(lines: MinLine[]): string {
  return djb2([
    String(lines.length),
    lines.slice(0, 5).map(l => (l.name ?? '').toLowerCase().trim()).join('|'),
  ].join('::'))
}
