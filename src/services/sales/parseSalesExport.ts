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

export const PARSER_VERSION = 3;

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

export type CategoryTotal = {
  name: string;
  parent: string | null;
  qty: number;
  totalIncl: number;
  /** true when at least one item row is directly assigned to this category. */
  itemised: boolean;
};

export type ReportTotals = {
  qty: number;
  totalIncl: number;
  totalExcl: number | null;
  source: 'subtotal' | 'sum_of_lines';
};

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
  kind: 'items' | 'summary' | 'unknown';
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
  categoryTotals: CategoryTotal[];
  controlTotal: number | null;
  /** null = no control total present; true/false = within/outside 1% tolerance. */
  controlTotalReconciled: boolean | null;
  reportTotals: ReportTotals | null;
  warnings: string[];
  /** Informational notes (not errors). */
  notes: string[];
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

// ── Parent category detection ──────────────────────────────────────────────

type CatEntry = {
  name: string;
  qty: number;
  totalIncl: number;
  itemised: boolean;
};

/**
 * For each category, check if a contiguous range of subsequent categories
 * sums to its total (within 1% tolerance).  The first matching range wins.
 * Returns a map from child-name → parent-name.
 */
function detectParents(cats: CatEntry[]): Map<string, string> {
  const childToParent = new Map<string, string>();
  for (let i = 0; i < cats.length; i++) {
    const parent = cats[i];
    if (parent.totalIncl <= 0) continue;
    let runningSum = 0;
    for (let j = i + 1; j < cats.length; j++) {
      runningSum += cats[j].totalIncl;
      if (reconcile(runningSum, parent.totalIncl)) {
        for (let k = i + 1; k <= j; k++) {
          childToParent.set(cats[k].name, parent.name);
        }
        break;
      }
      if (runningSum > parent.totalIncl * 1.02) break;
    }
  }
  return childToParent;
}

// ── Main export ────────────────────────────────────────────────────────────

export function parseSalesExport(rows: string[][]): ParsedSalesExport {
  const warnings: string[] = [];
  const notes: string[] = [];

  if (rows.length === 0) {
    return {
      format: 'generic', sourceFormat: 'generic', parserVersion: PARSER_VERSION,
      kind: 'unknown',
      headerRowIndex: 0,
      columns: { name: null, qty: null, totalExcl: null, totalIncl: null, unitPrice: null, category: null },
      lines: [], categories: [], categoryTotals: [],
      controlTotal: null, controlTotalReconciled: null, reportTotals: null,
      warnings: ['empty input'], notes: [],
      lineTotalsBasis: 'line_total', gstBasis: 'unknown',
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

  // Summary detection: no name column means this is a summary report (Date, Gross Sales, etc.)
  if (cols.nameIdx < 0) {
    return {
      format, sourceFormat: format, parserVersion: PARSER_VERSION,
      kind: 'summary',
      headerRowIndex: headerIdx,
      columns: {
        name: null,
        qty: cols.qtyLabel,
        totalExcl: cols.totalExclLabel,
        totalIncl: cols.totalInclLabel,
        unitPrice: cols.unitPriceLabel,
        category: cols.categoryLabel,
      },
      lines: [], categories: [], categoryTotals: [],
      controlTotal: null, controlTotalReconciled: null, reportTotals: null,
      warnings: ['This looks like a sales summary, not an item report. Export the items report instead.'],
      notes: [],
      lineTotalsBasis: 'line_total', gstBasis,
    };
  }

  const lines: ParsedSalesLine[] = [];
  const categories: string[] = [];
  let controlTotal: number | null = null;
  let subtotalQty = 0;
  let subtotalExcl: number | null = null;

  // bustle_items category tracking
  const catEntries: CatEntry[] = [];
  let currentCategoryName: string | null = null;
  let currentCatEntryIdx = -1;

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
      const qtyRaw = get(cols.qtyIdx);
      subtotalQty = qtyRaw ? (parseFloat(qtyRaw.replace(/,/g, '')) || 0) : 0;
      if (cols.totalExclIdx >= 0) subtotalExcl = parseMoney(get(cols.totalExclIdx));
      continue;
    }

    // Format B category row: unit-price cell is empty → category, not a product line
    if (format === 'bustle_items') {
      const upCell = get(cols.unitPriceIdx);
      if (!upCell || parseMoney(upCell) === null) {
        const catQtyRaw = get(cols.qtyIdx);
        const catQty = catQtyRaw ? (parseFloat(catQtyRaw.replace(/,/g, '')) || 0) : 0;
        const catTotalIncl = parseMoney(get(cols.totalInclIdx)) ?? parseMoney(get(cols.totalExclIdx)) ?? 0;
        catEntries.push({ name, qty: catQty, totalIncl: catTotalIncl, itemised: false });
        currentCategoryName = name;
        currentCatEntryIdx = catEntries.length - 1;
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

    // Category: for bustle_items, use currentCategoryName; for others use category column
    let category: string | null;
    if (format === 'bustle_items') {
      category = currentCategoryName;
      // Mark the current category entry as itemised
      if (currentCatEntryIdx >= 0) {
        catEntries[currentCatEntryIdx].itemised = true;
      }
    } else {
      category = cols.categoryIdx >= 0 ? (get(cols.categoryIdx) || null) : null;
    }

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

  // ── Category totals and parent detection ────────────────────────────────
  const childToParent = detectParents(catEntries);
  const categoryTotals: CategoryTotal[] = catEntries.map(ce => ({
    name: ce.name,
    parent: childToParent.get(ce.name) ?? null,
    qty: ce.qty,
    totalIncl: ce.totalIncl,
    itemised: ce.itemised,
  }));

  // ── Control total reconciliation ────────────────────────────────────────
  let controlTotalReconciled: boolean | null = null;
  if (controlTotal !== null) {
    const itemSum = lines.reduce((s, l) => s + (l.grossIncl ?? 0), 0);

    // Extended reconciliation: items + unitemised leaf categories vs Subtotal
    const parentNames = new Set(categoryTotals.map(ct => ct.parent).filter((p): p is string => p !== null));
    const unitemisedLeafs = categoryTotals.filter(ct => !ct.itemised && !parentNames.has(ct.name));
    const unitemisedSum = unitemisedLeafs.reduce((s, ct) => s + ct.totalIncl, 0);
    const extendedSum = itemSum + unitemisedSum;

    controlTotalReconciled = reconcile(extendedSum, controlTotal);

    if (controlTotalReconciled) {
      if (unitemisedLeafs.length > 0) {
        notes.push(
          `Unitemised: ${unitemisedLeafs.map(ct => `${ct.name} $${ct.totalIncl.toFixed(2)}`).join('; ')}` +
          ` (${lines.length} items $${itemSum.toFixed(2)} + unitemised $${unitemisedSum.toFixed(2)} = Subtotal $${controlTotal.toFixed(2)})`
        );
      }
    } else {
      const pct = Math.abs((extendedSum - controlTotal) / controlTotal * 100).toFixed(1);
      warnings.push(
        `Control total mismatch: line totals sum to ${extendedSum.toFixed(2)} ` +
        `but Subtotal is ${controlTotal.toFixed(2)} (${pct}% difference).`
      );
    }
  }

  // ── Report totals ────────────────────────────────────────────────────────
  let reportTotals: ReportTotals | null = null;
  {
    const itemSum = lines.reduce((s, l) => s + (l.grossIncl ?? 0), 0);
    const itemQty = lines.reduce((s, l) => s + l.qtySold, 0);
    if (controlTotal !== null) {
      reportTotals = {
        qty: subtotalQty > 0 ? subtotalQty : itemQty,
        totalIncl: controlTotal,
        totalExcl: subtotalExcl,
        source: 'subtotal',
      };
    } else if (lines.length > 0) {
      const itemNetSum = lines.reduce((s, l) => s + (l.netExcl ?? 0), 0);
      reportTotals = {
        qty: itemQty,
        totalIncl: itemSum,
        totalExcl: itemNetSum > 0 ? itemNetSum : null,
        source: 'sum_of_lines',
      };
    }
  }

  // ── Report kind ──────────────────────────────────────────────────────────
  const kind: 'items' | 'summary' | 'unknown' =
    (format === 'bustle_items' || format === 'bustle_rich') ? 'items' : 'unknown';

  return {
    format,
    sourceFormat: format,
    parserVersion: PARSER_VERSION,
    kind,
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
    categoryTotals,
    controlTotal,
    controlTotalReconciled,
    reportTotals,
    warnings,
    notes,
    lineTotalsBasis: 'line_total',
    gstBasis,
  };
}
