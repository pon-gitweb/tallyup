/**
 * Pure CSV-building utility for the stock holding export.
 * No React or Firebase imports — safe to unit-test from the mobile Jest suite.
 */

/** Plain-English label for the quantityConfidence field — exports only. */
export function fmtQuantityConfidence(qc?: string): string {
  if (qc === 'physical_count') return 'Confirmed'
  if (qc === 'estimated_with_sales') return 'Estimated (with sales data)'
  // 'estimated_no_sales' or absent/undefined → least-confident tier label
  return 'Estimated (no sales data)'
}

function fmtQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

/**
 * Minimum row shape required by exportCsvBlob.
 * StockPage's Row and UnplacedRow are structural supertypes — both assignable here.
 */
export type CsvRow = {
  name: string
  category: string | null
  supplierName: string | null
  onHand: number
  costPrice: number | null
  lineValue: number | null
  quantityConfidence?: string
}

export function exportCsvBlob(
  deptGroups: Map<string, { deptName: string; rows: CsvRow[] }>,
  unplaced: CsvRow[],
): string {
  const headers = [
    'Department', 'Product', 'Category', 'Supplier',
    'On Hand', 'Unit Cost', 'Line Value', 'Quantity Basis',
  ]
  const placed = [...deptGroups.entries()].flatMap(([, g]) =>
    g.rows.map(r => [
      g.deptName, r.name, r.category || '', r.supplierName || '',
      fmtQty(r.onHand),
      r.costPrice != null ? r.costPrice.toFixed(2) : '',
      r.lineValue != null ? r.lineValue.toFixed(2) : '',
      fmtQuantityConfidence(r.quantityConfidence),
    ])
  )
  const unpl = unplaced.map(r => [
    'Unplaced', r.name, r.category || '', r.supplierName || '',
    fmtQty(r.onHand),
    r.costPrice != null ? r.costPrice.toFixed(2) : '',
    r.lineValue != null ? r.lineValue.toFixed(2) : '',
    fmtQuantityConfidence(r.quantityConfidence),
  ])
  return [headers, ...placed, ...unpl]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
