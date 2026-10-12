/**
 * parseSalesExport — pure CSV-to-sales-line parser.
 *
 * Handles:
 *   bustle_rich   — Bustle "rich" 15-column export with separate GST incl/excl totals
 *   bustle_items  — Bustle "items" export with hierarchical category rows + Subtotal
 *   generic       — single-total CSV (one revenue column, optional qty)
 *   hosti_flat    — internal flat format: name, qty_sold, gross, net, tax
 *
 * Key invariants:
 *   - 'gross' on every output line is a LINE TOTAL, never a unit price.
 *   - Revenue columns are detected by explicit role matching; unit-price columns
 *     (matching UNIT_PRICE_PATTERNS) are NEVER assigned to the revenue role.
 *   - 'net' is set ONLY when the source file supplies a GST-excl column; it is
 *     never invented.  Budget code should use net ?? gross / 1.15.
 *
 * PARSER_VERSION: bump when output schema changes in a way that invalidates stored docs.
 *
 * SYNC: canonical copy → src/services/sales/parseSalesExport.ts
 *       web copy        → web-app/src/utils/parseSalesExport.ts
 * A test verifies both files are byte-for-byte identical.
 */

export const PARSER_VERSION = 1;

// ── Types ──────────────────────────────────────────────────────────────────

export type SourceFormat =
  | 'bustle_rich'
  | 'bustle_items'
  | 'generic'
  | 'hosti_flat';

export type GstBasis =
  | 'explicit'       // file supplies both GST-incl and GST-excl total columns
  | 'assumed_incl'   // single total column — assumed GST-inclusive
  | 'unknown';

export type ParsedSalesLine = {
  name: string;
  qtySold: number;
  /** Line total, GST incl when known. Always a TOTAL (not a unit price). */
  grossIncl: number | null;
  /** Line total, GST excl. Set only when the source file provides it. */
  netExcl: number | null;
  unitPrice: number | null;
  category: string | null;
  /** true when total was derived as qty × unitPrice (no total column in file). */
  derived: boolean;
  /** Legacy alias for grossIncl — always a line total, never a unit price. */
  gross: number | null;
  /** Legacy alias for netExcl. */
  net: number | null;
};

export type ParsedSalesExport = {
  format: SourceFormat;
  sourceFormat: SourceFormat;
  parserVersion: number;
  headerRowIndex: number;
  columns: {
    name: string | null;
    qty: string | null;
    totalExcl: string | null;
    totalIncl: string | null;
    /** Column identified as a unit price — excluded from revenue role. */
    unitPrice: string | null;
    category: string | null;
  };
  lines: ParsedSalesLine[];
  categories: string[];
  controlTotal: number | null;
  /** null = no control total present; true/false = within/outside 1% tolerance. */
  controlTotalReconciled: boolean | null;
  warnings: string[];
  lineTotalsBasis: 'line_total';
  gstBasis: GstBasis;
};

// ── CSV parser ─────────────────────────────────────────────────────────────

/**
 * Parse CSV text into a 2-D string array.
 * Handles RFC 4180: double-quote escaping, multi-line quoted cells.
 * A header cell containing a newline (e.g. "Gross Profit %\n(GST excl)") is
 * kept as a single cell — the newline survives unquoting.
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch; // newline inside quoted cell → stays in cell
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ── Money parser ───────────────────────────────────────────────────────────

/** Strip $, commas and whitespace. "Not Recorded", empty, "-" → null. */
export function parseMoney(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || /^not\s+recorded$/i.test(t) || t === '-' || t === 'N/A') return null;
  const n = Number(t.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ── Column role detection ──────────────────────────────────────────────────

/**
 * Patterns that conclusively identify a UNIT PRICE column.
 * These columns must NEVER be assigned the revenue role.
 */
const UNIT_PRICE_PATTERNS: RegExp[] = [
  /average\s+sales\s+price/i,
  /^sales\s+price$/i,
  /^price$/i,
  /^unit\s+price$/i,
  /^cost\s+price/i,
  /^avg\.?\s+price/i,
];

function isUnitPriceHeader(cell: string): boolean {
  const c = cell.trim();
  return UNIT_PRICE_PATTERNS.some(p => p.test(c));
}

/** Normalise a header cell for matching: lowercase, collapse whitespace+newlines. */
function normH(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
}

type RoleMatcher = { exact: string[]; contains: string[] };

const MATCHERS: Record<string, RoleMatcher> = {
  name: {
    exact: ['item name', 'name', 'item', 'product', 'description', 'product name'],
    contains: ['item name', 'product name'],
  },
  qty: {
    exact: ['quantity', 'qty', 'qty sold', 'count', 'units sold', 'qty_sold'],
    contains: ['quantity', 'qty sold', 'units sold'],
  },
  totalExcl: {
    exact: [
      'period total (gst excl)',
      'net sales',
      'total excl',
      'total (excl. gst)',
      'total excl gst',
      'net',
    ],
    contains: ['gst excl', 'excl. gst', 'net sales'],
  },
  totalIncl: {
    exact: [
      'period total (gst incl)',
      'total sales',
      'revenue',
      'gross sales',
      'amount',
      'total incl',
      'total (incl. gst)',
      'total incl gst',
      'gross',
    ],
    contains: ['gst incl', 'total sales', 'revenue', 'gross sales'],
  },
  category: {
    exact: ['category', 'department', 'group'],
    contains: ['category'],
  },
};

function assignColumns(rawHeader: string[]): {
  nameIdx: number;
  qtyIdx: number;
  totalExclIdx: number;
  totalInclIdx: number;
  unitPriceIdx: number;
  categoryIdx: number;
  nameLabel: string | null;
  qtyLabel: string | null;
  totalExclLabel: string | null;
  totalInclLabel: string | null;
  unitPriceLabel: string | null;
  categoryLabel: string | null;
} {
  const header = rawHeader.map(normH);

  // Identify all unit-price columns upfront
  const unitPriceCols = new Set<number>();
  for (let i = 0; i < rawHeader.length; i++) {
    if (isUnitPriceHeader(rawHeader[i])) unitPriceCols.add(i);
  }

  function findRole(role: string, skipAlready: Set<number> = new Set()): number {
    const m = MATCHERS[role];
    if (!m) return -1;
    const isRev = role === 'totalIncl' || role === 'totalExcl';

    for (const name of m.exact) {
      const idx = header.indexOf(name);
      if (idx !== -1 && !skipAlready.has(idx) && !(isRev && unitPriceCols.has(idx))) return idx;
    }
    for (const frag of m.contains) {
      const idx = header.findIndex(h => h.includes(frag));
      if (idx !== -1 && !skipAlready.has(idx) && !(isRev && unitPriceCols.has(idx))) return idx;
    }
    return -1;
  }

  const nameIdx      = findRole('name');
  const qtyIdx       = findRole('qty');
  const totalExclIdx = findRole('totalExcl');
  // Avoid assigning same column to both totalIncl and totalExcl
  const usedForExcl  = totalExclIdx >= 0 ? new Set([totalExclIdx]) : new Set<number>();
  const totalInclIdx = findRole('totalIncl', usedForExcl);
  const categoryIdx  = findRole('category');
  const unitPriceIdx = unitPriceCols.size > 0 ? Math.min(...unitPriceCols) : -1;

  const label = (i: number) => (i >= 0 ? rawHeader[i] : null);
  return {
    nameIdx, qtyIdx, totalExclIdx, totalInclIdx, unitPriceIdx, categoryIdx,
    nameLabel: label(nameIdx),
    qtyLabel: label(qtyIdx),
    totalExclLabel: label(totalExclIdx),
    totalInclLabel: label(totalInclIdx),
    unitPriceLabel: label(unitPriceIdx),
    categoryLabel: label(categoryIdx),
  };
}

// ── Format detection ───────────────────────────────────────────────────────

function detectFormat(rows: string[][], headerIdx: number): SourceFormat {
  const header = (rows[headerIdx] ?? []).map(normH);

  // hosti_flat: the internal mobile format — has 'qty_sold' and/or 'gross'
  if (header.includes('qty_sold')) return 'hosti_flat';

  // bustle_rich: has both "period total (gst incl)" and "period total (gst excl)"
  const hasInclPeriod = header.some(h => h.includes('period total') && h.includes('gst incl'));
  const hasExclPeriod = header.some(h => h.includes('period total') && h.includes('gst excl'));
  if (hasInclPeriod && hasExclPeriod) return 'bustle_rich';

  // bustle_items: title row "Items", plus "sales price" and "count" in header
  const titleRow = headerIdx > 0 ? normH(rows[0]?.[0] ?? '') : '';
  if (
    titleRow === 'items' &&
    header.some(h => /^sales\s+price$/.test(h)) &&
    header.includes('count')
  ) return 'bustle_items';

  return 'generic';
}

// ── Header row scanner ─────────────────────────────────────────────────────

const MAX_HEADER_SCAN = 15;

function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i++) {
    const header = rows[i].map(normH);
    const hasName =
      MATCHERS.name.exact.some(n => header.includes(n)) ||
      MATCHERS.name.contains.some(f => header.some(h => h.includes(f)));
    if (!hasName) continue;

    const hasQtyOrMoney =
      MATCHERS.qty.exact.some(n => header.includes(n)) ||
      MATCHERS.qty.contains.some(f => header.some(h => h.includes(f))) ||
      MATCHERS.totalIncl.exact.some(n => header.includes(n)) ||
      MATCHERS.totalIncl.contains.some(f => header.some(h => h.includes(f))) ||
      MATCHERS.totalExcl.exact.some(n => header.includes(n)) ||
      MATCHERS.totalExcl.contains.some(f => header.some(h => h.includes(f))) ||
      header.some(h => isUnitPriceHeader(h));

    if (hasQtyOrMoney) return i;
  }
  return 0;
}

// ── Control total reconciliation ───────────────────────────────────────────

function reconcile(lineTotal: number, controlTotal: number): boolean {
  if (controlTotal === 0) return lineTotal === 0;
  return Math.abs(lineTotal - controlTotal) / Math.abs(controlTotal) <= 0.01;
}

// ── Main export ────────────────────────────────────────────────────────────

export function parseSalesExport(rows: string[][]): ParsedSalesExport {
  const warnings: string[] = [];

  if (rows.length === 0) {
    return {
      format: 'generic', sourceFormat: 'generic', parserVersion: PARSER_VERSION,
      headerRowIndex: 0,
      columns: { name: null, qty: null, totalExcl: null, totalIncl: null, unitPrice: null, category: null },
      lines: [], categories: [], controlTotal: null, controlTotalReconciled: null,
      warnings: ['empty input'], lineTotalsBasis: 'line_total', gstBasis: 'unknown',
    };
  }

  const headerIdx = findHeaderRowIndex(rows);
  const rawHeader = rows[headerIdx] ?? [];
  const format = detectFormat(rows, headerIdx);
  const cols = assignColumns(rawHeader);

  // Derived mode: no total column, but unitPrice + qty exist
  const derived =
    cols.totalInclIdx < 0 && cols.totalExclIdx < 0 &&
    cols.unitPriceIdx >= 0 && cols.qtyIdx >= 0;

  if (derived) {
    warnings.push(
      'No total column found — revenue derived as qty × unit price. Verify against your POS.'
    );
  }

  // GST basis
  let gstBasis: GstBasis;
  if (format === 'bustle_rich') {
    gstBasis = 'explicit';
  } else if (format === 'hosti_flat') {
    gstBasis = 'unknown';
  } else if (derived || cols.totalInclIdx >= 0 || format === 'bustle_items') {
    gstBasis = 'assumed_incl';
  } else {
    gstBasis = 'unknown';
  }

  const lines: ParsedSalesLine[] = [];
  const categories: string[] = [];
  let controlTotal: number | null = null;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i: number): string =>
      i >= 0 && i < row.length ? (row[i]?.trim() ?? '') : '';

    const name = get(cols.nameIdx);
    if (!name) continue;

    // Subtotal / grand total row → extract control total, skip as data row
    if (/^(subtotal|grand total|total)$/i.test(name)) {
      const ct =
        parseMoney(get(cols.totalInclIdx)) ??
        parseMoney(get(cols.totalExclIdx));
      if (ct !== null) controlTotal = ct;
      continue;
    }

    // Format B category row: unit-price cell is empty → category, not a product line
    if (format === 'bustle_items') {
      const upCell = get(cols.unitPriceIdx);
      if (!upCell || parseMoney(upCell) === null) {
        categories.push(name);
        continue;
      }
    }

    // Revenue
    let grossIncl: number | null = null;
    let netExcl: number | null = null;
    let lineDerived = false;

    if (derived) {
      const up = parseMoney(get(cols.unitPriceIdx));
      const qtyRaw = get(cols.qtyIdx);
      const qty = qtyRaw ? (parseFloat(qtyRaw.replace(/,/g, '')) || 0) : 0;
      if (up !== null && qty > 0) { grossIncl = qty * up; lineDerived = true; }
    } else {
      grossIncl = parseMoney(get(cols.totalInclIdx));
      if (cols.totalExclIdx >= 0) netExcl = parseMoney(get(cols.totalExclIdx));
    }

    // Qty
    const qtyRaw = get(cols.qtyIdx);
    const qtySold = qtyRaw ? (parseFloat(qtyRaw.replace(/,/g, '')) || 0) : 0;

    // Unit price (stored for reference, never used as gross)
    const unitPrice = cols.unitPriceIdx >= 0 ? parseMoney(get(cols.unitPriceIdx)) : null;

    // Category column (Format A and generic)
    const category = cols.categoryIdx >= 0 ? (get(cols.categoryIdx) || null) : null;

    lines.push({
      name,
      qtySold,
      grossIncl,
      netExcl,
      unitPrice,
      category,
      derived: lineDerived,
      gross: grossIncl,   // legacy alias — always a line total
      net: netExcl,       // legacy alias
    });
  }

  // Control total reconciliation
  let controlTotalReconciled: boolean | null = null;
  if (controlTotal !== null) {
    const lineSum = lines.reduce((s, l) => s + (l.grossIncl ?? 0), 0);
    controlTotalReconciled = reconcile(lineSum, controlTotal);
    if (!controlTotalReconciled) {
      const pct = Math.abs((lineSum - controlTotal) / controlTotal * 100).toFixed(1);
      warnings.push(
        `Control total mismatch: line totals sum to ${lineSum.toFixed(2)} ` +
        `but Subtotal is ${controlTotal.toFixed(2)} (${pct}% difference).`
      );
    }
  }

  return {
    format,
    sourceFormat: format,
    parserVersion: PARSER_VERSION,
    headerRowIndex: headerIdx,
    columns: {
      name: cols.nameLabel,
      qty: cols.qtyLabel,
      totalExcl: cols.totalExclLabel,
      totalIncl: cols.totalInclLabel,
      unitPrice: cols.unitPriceLabel,
      category: cols.categoryLabel,
    },
    lines,
    categories: [...new Set(categories)],
    controlTotal,
    controlTotalReconciled,
    warnings,
    lineTotalsBasis: 'line_total',
    gstBasis,
  };
}
