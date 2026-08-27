// Integration test for exportCsvBlob — asserts on the function's actual CSV output
// for unplaced rows with each of the four quantityConfidence states.
//
// This is the wiring test a pure fmtQuantityConfidence unit test cannot catch:
// it verifies the call site inside exportCsvBlob (specifically the unpl mapping)
// uses fmtQuantityConfidence(r.quantityConfidence), not a raw fallback.

import { exportCsvBlob, type CsvRow } from '../../../web-app/src/utils/stockCsvExport';

// ── Helper: parse the Quantity Basis value from a given CSV data row ──────────

function parseCsvRow(csv: string, dataRowIndex: number): string[] {
  const lines = csv.split('\n');
  // dataRowIndex 0 = header, 1 = first data row, etc.
  const line = lines[dataRowIndex];
  // Strip outer quotes from each field and split on `","` (the inter-field boundary
  // after the outer quotes are removed — works for our controlled test data that
  // contains no embedded commas or quotes).
  return line.slice(1, -1).split('","');
}

function quantityBasisOf(csv: string, dataRowIndex: number): string {
  const cols = parseCsvRow(csv, dataRowIndex);
  return cols[cols.length - 1]; // 'Quantity Basis' is the last column
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeUnplacedRow(qc?: string): CsvRow {
  return {
    name: 'Beer',
    category: 'Drinks',
    supplierName: null,
    onHand: 5,
    costPrice: 10,
    lineValue: 50,
    quantityConfidence: qc,
  };
}

const emptyDeptGroups = new Map<string, { deptName: string; rows: CsvRow[] }>();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exportCsvBlob — Quantity Basis column for unplaced rows', () => {
  it("physical_count → 'Confirmed'", () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow('physical_count')]);
    expect(quantityBasisOf(csv, 1)).toBe('Confirmed');
  });

  it("estimated_with_sales → 'Estimated (with sales data)'", () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow('estimated_with_sales')]);
    expect(quantityBasisOf(csv, 1)).toBe('Estimated (with sales data)');
  });

  it("estimated_no_sales → 'Estimated (no sales data)'", () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow('estimated_no_sales')]);
    expect(quantityBasisOf(csv, 1)).toBe('Estimated (no sales data)');
  });

  it("absent / undefined → 'Estimated (no sales data)' (no-information = least-confident tier)", () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow(undefined)]);
    expect(quantityBasisOf(csv, 1)).toBe('Estimated (no sales data)');
  });

  it('header row names the column Quantity Basis', () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow('physical_count')]);
    const headers = parseCsvRow(csv, 0);
    expect(headers[headers.length - 1]).toBe('Quantity Basis');
  });

  it('Department column for unplaced rows is Unplaced', () => {
    const csv = exportCsvBlob(emptyDeptGroups, [makeUnplacedRow('physical_count')]);
    const cols = parseCsvRow(csv, 1);
    expect(cols[0]).toBe('Unplaced');
  });
});
