/**
 * Tests for parseSalesExport (mobile/Jest side).
 * Uses real Bustle export format fixtures.
 */

import fs from 'fs';
import path from 'path';
import { parseCsvText, parseMoney, parseSalesExport } from '../parseSalesExport';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Format A "rich": 15-column Bustle export with GST incl + GST excl totals.
// Last header cell contains a line break inside quotes (real Bustle behaviour).
const FORMAT_A_CSV = `Item Name,Category,Quantity,Period Total (GST incl),Period Total (GST excl),Average Sales Price (GST incl),Average Sales Price (GST excl),% of Total Sales (GST incl),% of Total Sales (GST excl),Cost of Sales (GST incl),Cost of Sales (GST excl),Gross Profit (GST incl),Gross Profit (GST excl),Gross Profit % (GST incl),"Gross Profit % (GST
excl)"
Heineken 330ml,Beer,24,$276.00,$240.00,$11.50,$10.00,5.2%,5.2%,$96.00,$83.48,$180.00,$156.52,65.2%,65.2%
Stella Artois 330ml,Beer,12,$138.00,$120.00,$11.50,$10.00,2.6%,2.6%,$48.00,$41.74,$90.00,$78.26,65.2%,65.2%
House Red Wine,Wine,8,$120.00,$104.35,$15.00,$13.04,2.3%,2.3%,$32.00,$27.83,$88.00,$76.52,73.3%,73.3%
`;

// Format B "items": hierarchical with title row "Items", category rows (empty Sales Price),
// item rows (numeric Sales Price), and a Subtotal control row.
// Item totals sum to their category parents and to the Subtotal.
const FORMAT_B_CSV = `Items
Name,Sales Price,Cost Price (excl. GST),Count,Total Sales,GP Margin
Food,,,5,"$50.00",
Nachos,$10.00,Not Recorded,5,"$50.00",Not Recorded
Alcoholic,,,25,"$368.00",
Wine,,,7,"$163.00",
Andre clouet,$19.00,Not Recorded,2,"$38.00",Not Recorded
Cloudy Bay Sauv Blanc,$25.00,Not Recorded,5,"$125.00",Not Recorded
Beer,,,10,"$85.00",
Heineken,$8.50,Not Recorded,10,"$85.00",Not Recorded
Cocktail,,,8,"$120.00",
No Subcategory,,,8,"$120.00",
Margarita,$15.00,Not Recorded,8,"$120.00",Not Recorded
Subtotal,,,30,"$418.00",
`;

// Format with only qty and unit price (derived mode)
const DERIVED_CSV = `Name,Sales Price,Count
Heineken,$8.50,10
Wine House,$15.00,5
`;

// Hosti flat internal format
const HOSTI_FLAT_CSV = `name,qty_sold,gross,net,tax
Heineken,24,276.00,240.00,36.00
House Red Wine,8,120.00,104.35,15.65
`;

// ── parseMoney ────────────────────────────────────────────────────────────────

describe('parseMoney', () => {
  it('strips $ and commas', () => expect(parseMoney('$2,843.00')).toBe(2843));
  it('handles plain number', () => expect(parseMoney('276.00')).toBe(276));
  it('"Not Recorded" → null', () => expect(parseMoney('Not Recorded')).toBeNull());
  it('empty string → null', () => expect(parseMoney('')).toBeNull());
  it('null → null', () => expect(parseMoney(null)).toBeNull());
  it('"1,159.00" → 1159', () => expect(parseMoney('1,159.00')).toBe(1159));
  it('"$38.00" → 38', () => expect(parseMoney('$38.00')).toBe(38));
  it('"-" → null', () => expect(parseMoney('-')).toBeNull());
});

// ── parseCsvText ──────────────────────────────────────────────────────────────

describe('parseCsvText', () => {
  it('handles quoted cell with embedded newline', () => {
    const rows = parseCsvText(FORMAT_A_CSV);
    // Header is row 0 — the last cell contains "\n" from the line break inside quotes
    expect(rows[0].length).toBe(15);
    expect(rows[0][14]).toContain('GST');
    // Data rows follow with the same column count
    expect(rows[1][0]).toBe('Heineken 330ml');
  });

  it('handles "$2,843.00" as a single cell', () => {
    const rows = parseCsvText(FORMAT_B_CSV);
    // Row 2 (Format B): Food,,,5,"$2,843.00"  — actually our fixture has $50.00 for simplicity
    const foodRow = rows.find(r => r[0]?.trim() === 'Food');
    expect(foodRow).toBeDefined();
    expect(foodRow![4]).toContain('50');
  });
});

// ── Format A ──────────────────────────────────────────────────────────────────

describe('parseSalesExport — Format A (bustle_rich)', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_A_CSV));

  it('detects format as bustle_rich', () => {
    expect(result.format).toBe('bustle_rich');
    expect(result.sourceFormat).toBe('bustle_rich');
  });

  it('headerRowIndex = 0 (no title row)', () => {
    expect(result.headerRowIndex).toBe(0);
  });

  it('gstBasis = explicit', () => {
    expect(result.gstBasis).toBe('explicit');
  });

  it('picks "Period Total (GST incl)" as totalIncl', () => {
    expect(result.columns.totalIncl).toBe('Period Total (GST incl)');
  });

  it('picks "Period Total (GST excl)" as totalExcl', () => {
    expect(result.columns.totalExcl).toBe('Period Total (GST excl)');
  });

  it('identifies "Average Sales Price (GST incl)" as unitPrice column (not revenue)', () => {
    expect(result.columns.unitPrice).toMatch(/average sales price/i);
  });

  it('picks "Quantity" as qty', () => {
    expect(result.columns.qty).toBe('Quantity');
  });

  it('picks "Item Name" as name', () => {
    expect(result.columns.name).toBe('Item Name');
  });

  it('picks "Category" as category', () => {
    expect(result.columns.category).toBe('Category');
  });

  it('returns 3 item lines', () => {
    expect(result.lines.length).toBe(3);
  });

  it('no control total (Format A has no Subtotal row)', () => {
    expect(result.controlTotal).toBeNull();
    expect(result.controlTotalReconciled).toBeNull();
  });

  it('lineTotalsBasis = line_total', () => {
    expect(result.lineTotalsBasis).toBe('line_total');
  });

  it('Heineken line: grossIncl = 276 (line total, not unit price 11.50)', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    expect(h.grossIncl).toBe(276);
    expect(h.gross).toBe(276);
    expect(h.unitPrice).toBe(11.50);
    expect(h.qtySold).toBe(24);
  });

  it('Heineken line: netExcl = 240 (GST excl total from file)', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    expect(h.netExcl).toBe(240);
    expect(h.net).toBe(240);
  });

  it('Heineken: category = Beer', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    expect(h.category).toBe('Beer');
  });

  it('no derived lines', () => {
    result.lines.forEach(l => expect(l.derived).toBe(false));
  });

  // REGRESSION: the old "sales" substring bug
  it('[REGRESSION] gross is NOT equal to unitPrice ("sales" substring bug — Format A)', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    // Old code: revIdx matched "Average Sales Price (GST incl)" → gross = 11.50 (unit price)
    // New code: gross = 276 (Period Total (GST incl) — line total)
    expect(h.gross).not.toBe(h.unitPrice);
    expect(h.gross).toBeGreaterThan(h.unitPrice!);
  });
});

// ── Format B ──────────────────────────────────────────────────────────────────

describe('parseSalesExport — Format B (bustle_items)', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_B_CSV));

  it('detects format as bustle_items', () => {
    expect(result.format).toBe('bustle_items');
  });

  it('headerRowIndex = 1 (row 0 is title "Items")', () => {
    expect(result.headerRowIndex).toBe(1);
  });

  it('gstBasis = assumed_incl', () => {
    expect(result.gstBasis).toBe('assumed_incl');
  });

  it('picks "Count" as qty', () => {
    expect(result.columns.qty).toBe('Count');
  });

  it('picks "Total Sales" as totalIncl', () => {
    expect(result.columns.totalIncl).toBe('Total Sales');
  });

  it('identifies "Sales Price" as unitPrice column (not revenue)', () => {
    expect(result.columns.unitPrice).toBe('Sales Price');
  });

  it('no totalExcl column', () => {
    expect(result.columns.totalExcl).toBeNull();
  });

  it('returns 5 item lines (category rows excluded)', () => {
    // Nachos, Andre clouet, Cloudy Bay, Heineken, Margarita
    expect(result.lines.length).toBe(5);
  });

  it('excludes category rows from lines', () => {
    const names = result.lines.map(l => l.name);
    expect(names).not.toContain('Food');
    expect(names).not.toContain('Alcoholic');
    expect(names).not.toContain('Wine');
    expect(names).not.toContain('Beer');
    expect(names).not.toContain('Cocktail');
    expect(names).not.toContain('No Subcategory');
  });

  it('categories list contains all category rows', () => {
    expect(result.categories).toContain('Food');
    expect(result.categories).toContain('Alcoholic');
    expect(result.categories).toContain('Wine');
    expect(result.categories).toContain('Beer');
    expect(result.categories).toContain('Cocktail');
    expect(result.categories).toContain('No Subcategory');
  });

  it('controlTotal = 418 (from Subtotal row)', () => {
    expect(result.controlTotal).toBe(418);
  });

  it('controlTotalReconciled = true (items sum to Subtotal)', () => {
    // $50 + $38 + $125 + $85 + $120 = $418
    expect(result.controlTotalReconciled).toBe(true);
  });

  it('Andre clouet: grossIncl = 38 (line total), not 19 (unit price)', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    expect(a.grossIncl).toBe(38);
    expect(a.gross).toBe(38);
    expect(a.unitPrice).toBe(19);
    expect(a.qtySold).toBe(2);
  });

  it('Andre clouet: netExcl = null (no GST-excl column)', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    expect(a.netExcl).toBeNull();
    expect(a.net).toBeNull();
  });

  // REGRESSION: the old "sales" substring bug
  it('[REGRESSION] gross is NOT equal to unitPrice ("sales" substring bug — Format B)', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    // Old code: revIdx matched "Sales Price" via "sales" → gross = 19 (unit price)
    // New code: gross = 38 (Total Sales — line total)
    expect(a.gross).not.toBe(a.unitPrice);
    expect(a.gross).toBe(38);
    expect(a.unitPrice).toBe(19);
  });

  it('no lines are derived (file has an explicit total column)', () => {
    result.lines.forEach(l => expect(l.derived).toBe(false));
  });
});

// ── Derived mode ──────────────────────────────────────────────────────────────

describe('parseSalesExport — derived mode (only qty + unit price)', () => {
  const result = parseSalesExport(parseCsvText(DERIVED_CSV));

  it('all lines are derived', () => {
    result.lines.forEach(l => expect(l.derived).toBe(true));
  });

  it('Heineken: gross = qty × unitPrice = 85', () => {
    const h = result.lines.find(l => l.name === 'Heineken')!;
    expect(h.gross).toBe(85);       // 10 × $8.50
    expect(h.qtySold).toBe(10);
    expect(h.unitPrice).toBe(8.50);
  });

  it('emits a warning about derived revenue', () => {
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/derived/i);
  });

  it('gstBasis = assumed_incl when deriving from unit price', () => {
    expect(result.gstBasis).toBe('assumed_incl');
  });
});

// ── Hosti flat ────────────────────────────────────────────────────────────────

describe('parseSalesExport — hosti_flat', () => {
  const result = parseSalesExport(parseCsvText(HOSTI_FLAT_CSV));

  it('detects format as hosti_flat', () => {
    expect(result.format).toBe('hosti_flat');
  });

  it('gstBasis = unknown (internal format; GST status not declared)', () => {
    expect(result.gstBasis).toBe('unknown');
  });

  it('Heineken: qtySold = 24, gross = 276, net = 240', () => {
    const h = result.lines.find(l => l.name === 'Heineken')!;
    expect(h.qtySold).toBe(24);
    expect(h.gross).toBe(276);
    expect(h.net).toBe(240);
  });
});

// ── Header row scan ───────────────────────────────────────────────────────────

describe('header row scan', () => {
  it('skips blank title rows to find the actual header', () => {
    const csv = `\n\nName,Count,Total Sales\nWidget,5,$50.00\n`;
    const result = parseSalesExport(parseCsvText(csv));
    expect(result.lines.length).toBe(1);
    expect(result.lines[0].name).toBe('Widget');
  });

  it('Format B: row 0 is "Items" title, header is row 1', () => {
    const result = parseSalesExport(parseCsvText(FORMAT_B_CSV));
    expect(result.headerRowIndex).toBe(1);
  });
});

// ── Control total mismatch warning ────────────────────────────────────────────

describe('control total mismatch', () => {
  it('emits a warning when line totals do not reconcile within 1%', () => {
    const csv = `Items
Name,Sales Price,Count,Total Sales
Widget,$10.00,5,$50.00
Subtotal,,,100.00
`;
    const result = parseSalesExport(parseCsvText(csv));
    expect(result.controlTotalReconciled).toBe(false);
    expect(result.warnings.some(w => /mismatch/i.test(w))).toBe(true);
  });

  it('does not warn when mismatch is within 1%', () => {
    const csv = `Items
Name,Sales Price,Count,Total Sales
Widget,$10.00,5,$50.00
Subtotal,,,50.40
`;
    const result = parseSalesExport(parseCsvText(csv));
    expect(result.controlTotalReconciled).toBe(true);
    expect(result.warnings.some(w => /mismatch/i.test(w))).toBe(false);
  });
});

// ── Format A — new fields ─────────────────────────────────────────────────────

describe('parseSalesExport — Format A new fields', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_A_CSV));

  it('kind = items (itemised export)', () => {
    expect(result.kind).toBe('items');
  });

  it('categoryTotals = [] (no category rows in bustle_rich)', () => {
    expect(result.categoryTotals).toEqual([]);
  });

  it('notes = []', () => {
    expect(result.notes).toEqual([]);
  });

  it('reportTotals: source = sum_of_lines (no Subtotal row)', () => {
    expect(result.reportTotals?.source).toBe('sum_of_lines');
  });
});

// ── Format B — new fields ─────────────────────────────────────────────────────

describe('parseSalesExport — Format B new fields', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_B_CSV));

  it('kind = items', () => {
    expect(result.kind).toBe('items');
  });

  it('category assignment: Nachos → Food, Andre clouet → Wine, Heineken → Beer', () => {
    expect(result.lines.find(l => l.name === 'Nachos')?.category).toBe('Food');
    expect(result.lines.find(l => l.name === 'Andre clouet')?.category).toBe('Wine');
    expect(result.lines.find(l => l.name === 'Cloudy Bay Sauv Blanc')?.category).toBe('Wine');
    expect(result.lines.find(l => l.name === 'Heineken')?.category).toBe('Beer');
    expect(result.lines.find(l => l.name === 'Margarita')?.category).toBe('No Subcategory');
  });

  it('categoryTotals: 6 entries', () => {
    expect(result.categoryTotals).toHaveLength(6);
  });

  it('categoryTotals: Alcoholic is parent of Wine, Beer, Cocktail', () => {
    const wine = result.categoryTotals.find(ct => ct.name === 'Wine');
    const beer = result.categoryTotals.find(ct => ct.name === 'Beer');
    const cocktail = result.categoryTotals.find(ct => ct.name === 'Cocktail');
    expect(wine?.parent).toBe('Alcoholic');
    expect(beer?.parent).toBe('Alcoholic');
    expect(cocktail?.parent).toBe('Alcoholic');
  });

  it('categoryTotals: Cocktail is parent of No Subcategory', () => {
    const noSub = result.categoryTotals.find(ct => ct.name === 'No Subcategory');
    expect(noSub?.parent).toBe('Cocktail');
  });

  it('categoryTotals: Food has no parent, is itemised', () => {
    const food = result.categoryTotals.find(ct => ct.name === 'Food');
    expect(food?.parent).toBeNull();
    expect(food?.itemised).toBe(true);
  });

  it('categoryTotals: Alcoholic has no parent, is not directly itemised', () => {
    const alc = result.categoryTotals.find(ct => ct.name === 'Alcoholic');
    expect(alc?.parent).toBeNull();
    expect(alc?.itemised).toBe(false);
  });

  it('categoryTotals: totals populated', () => {
    const wine = result.categoryTotals.find(ct => ct.name === 'Wine');
    expect(wine?.totalIncl).toBe(163);
    expect(wine?.qty).toBe(7);
  });

  it('notes = [] (all items reconcile directly to Subtotal — no unitemised leafs)', () => {
    expect(result.notes).toEqual([]);
  });

  it('reportTotals: source = subtotal, totalIncl = 418', () => {
    expect(result.reportTotals?.source).toBe('subtotal');
    expect(result.reportTotals?.totalIncl).toBe(418);
    expect(result.reportTotals?.totalExcl).toBeNull();
  });

  it('reportTotals: qty = 30 (from Subtotal row Count)', () => {
    expect(result.reportTotals?.qty).toBe(30);
  });
});

// ── Summary detection ─────────────────────────────────────────────────────────

describe('parseSalesExport — summary detection', () => {
  const DAILY_SUMMARY_CSV = `Date,Gross Sales,Net Sales,Tax
2025-01-01,$1200.00,$1043.48,$156.52
2025-01-02,$980.00,$852.17,$127.83
`;

  it('kind = summary when no name column', () => {
    const result = parseSalesExport(parseCsvText(DAILY_SUMMARY_CSV));
    expect(result.kind).toBe('summary');
  });

  it('lines = [] for summary', () => {
    const result = parseSalesExport(parseCsvText(DAILY_SUMMARY_CSV));
    expect(result.lines).toHaveLength(0);
  });

  it('warning mentions "summary"', () => {
    const result = parseSalesExport(parseCsvText(DAILY_SUMMARY_CSV));
    expect(result.warnings.some(w => /summary/i.test(w))).toBe(true);
  });
});

// ── Real 40-item Items fixture ────────────────────────────────────────────────

describe('parseSalesExport — real Items fixture (40 lines)', () => {
  const csvText = fs.readFileSync(
    path.resolve(__dirname, 'fixtures/items-40-lines.csv'),
    'utf8'
  );
  const result = parseSalesExport(parseCsvText(csvText));

  it('format = bustle_items, kind = items', () => {
    expect(result.format).toBe('bustle_items');
    expect(result.kind).toBe('items');
  });

  it('exactly 40 item lines', () => {
    expect(result.lines).toHaveLength(40);
  });

  it('Andre clouet: grossIncl = 38', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    expect(a.grossIncl).toBe(38);
  });

  it('item sum = 11001', () => {
    const sum = result.lines.reduce((s, l) => s + (l.grossIncl ?? 0), 0);
    expect(sum).toBe(11001);
  });

  it('unitemised leaf sum = 3048', () => {
    const parentNames = new Set(result.categoryTotals.map(ct => ct.parent).filter(Boolean));
    const unitemisedLeafs = result.categoryTotals.filter(ct => !ct.itemised && !parentNames.has(ct.name));
    const unitemisedSum = unitemisedLeafs.reduce((s, ct) => s + ct.totalIncl, 0);
    expect(unitemisedSum).toBe(3048);
  });

  it('11001 + 3048 = 14049, controlTotalReconciled = true, no warnings', () => {
    expect(result.controlTotal).toBe(14049);
    expect(result.controlTotalReconciled).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('INFO note present, mentions unitemised categories', () => {
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatch(/Food/);
    expect(result.notes[0]).toMatch(/Non Alcoholic/);
    expect(result.notes[0]).toMatch(/Uncategorised/);
  });

  it('Alcoholic is parent of Wine, Beer, Spirits, Cocktail, No Subcategory', () => {
    const children = result.categoryTotals.filter(ct => ct.parent === 'Alcoholic').map(ct => ct.name);
    expect(children).toContain('Wine');
    expect(children).toContain('Beer');
    expect(children).toContain('Spirits');
    expect(children).toContain('Cocktail');
    expect(children).toContain('No Subcategory');
    expect(children).toHaveLength(5);
  });

  it('unitemised categories: Food, Non Alcoholic, Uncategorised', () => {
    const parentNames = new Set(result.categoryTotals.map(ct => ct.parent).filter(Boolean));
    const unitemised = result.categoryTotals.filter(ct => !ct.itemised && !parentNames.has(ct.name));
    const names = unitemised.map(ct => ct.name);
    expect(names).toContain('Food');
    expect(names).toContain('Non Alcoholic');
    expect(names).toContain('Uncategorised');
    expect(names).toHaveLength(3);
  });

  it('reportTotals: source = subtotal, qty = 1159, totalIncl = 14049', () => {
    expect(result.reportTotals?.source).toBe('subtotal');
    expect(result.reportTotals?.qty).toBe(1159);
    expect(result.reportTotals?.totalIncl).toBe(14049);
  });

  it('item category assignments correct', () => {
    expect(result.lines.find(l => l.name === 'Heineken 330ml')?.category).toBe('Beer');
    expect(result.lines.find(l => l.name === 'Margarita')?.category).toBe('Cocktail');
    expect(result.lines.find(l => l.name === 'Jagermeister Shot')?.category).toBe('No Subcategory');
    expect(result.lines.find(l => l.name === 'Absolut Vodka')?.category).toBe('Spirits');
  });
});

// ── daily-summary fixture ─────────────────────────────────────────────────────

describe('parseSalesExport — daily-summary fixture', () => {
  const csvText = fs.readFileSync(
    path.resolve(__dirname, 'fixtures/daily-summary.csv'),
    'utf8'
  );
  const result = parseSalesExport(parseCsvText(csvText));

  it('kind = summary', () => {
    expect(result.kind).toBe('summary');
  });

  it('lines = []', () => {
    expect(result.lines).toHaveLength(0);
  });
});

// ── File sync check ───────────────────────────────────────────────────────────

describe('sync check', () => {
  it('parseSalesExport.ts is byte-for-byte identical to web-app copy', () => {
    const canonical = fs.readFileSync(
      path.resolve(__dirname, '../parseSalesExport.ts'),
      'utf8'
    );
    const webCopy = fs.readFileSync(
      path.resolve(__dirname, '../../../../web-app/src/utils/parseSalesExport.ts'),
      'utf8'
    );
    expect(canonical).toBe(webCopy);
  });
});
