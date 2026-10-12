/**
 * Tests for parseSalesExport (web/Vitest side).
 * Mirrors the mobile Jest suite plus the sync check.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  parseCsvText,
  parseMoney,
  parseSalesExport,
} from '../utils/parseSalesExport';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FORMAT_A_CSV = `Item Name,Category,Quantity,Period Total (GST incl),Period Total (GST excl),Average Sales Price (GST incl),Average Sales Price (GST excl),% of Total Sales (GST incl),% of Total Sales (GST excl),Cost of Sales (GST incl),Cost of Sales (GST excl),Gross Profit (GST incl),Gross Profit (GST excl),Gross Profit % (GST incl),"Gross Profit % (GST
excl)"
Heineken 330ml,Beer,24,$276.00,$240.00,$11.50,$10.00,5.2%,5.2%,$96.00,$83.48,$180.00,$156.52,65.2%,65.2%
Stella Artois 330ml,Beer,12,$138.00,$120.00,$11.50,$10.00,2.6%,2.6%,$48.00,$41.74,$90.00,$78.26,65.2%,65.2%
House Red Wine,Wine,8,$120.00,$104.35,$15.00,$13.04,2.3%,2.3%,$32.00,$27.83,$88.00,$76.52,73.3%,73.3%
`;

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

const DERIVED_CSV = `Name,Sales Price,Count
Heineken,$8.50,10
Wine House,$15.00,5
`;

// ── parseMoney ─────────────────────────────────────────────────────────────────

describe('parseMoney', () => {
  it('strips $ and commas', () => expect(parseMoney('$2,843.00')).toBe(2843));
  it('"Not Recorded" → null', () => expect(parseMoney('Not Recorded')).toBeNull());
  it('empty string → null', () => expect(parseMoney('')).toBeNull());
  it('"1,159.00" → 1159', () => expect(parseMoney('1,159.00')).toBe(1159));
});

// ── Format A ───────────────────────────────────────────────────────────────────

describe('Format A (bustle_rich)', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_A_CSV));

  it('format = bustle_rich, gstBasis = explicit', () => {
    expect(result.format).toBe('bustle_rich');
    expect(result.gstBasis).toBe('explicit');
  });

  it('totalIncl = "Period Total (GST incl)", totalExcl = "Period Total (GST excl)"', () => {
    expect(result.columns.totalIncl).toBe('Period Total (GST incl)');
    expect(result.columns.totalExcl).toBe('Period Total (GST excl)');
  });

  it('unitPrice column identified (not used as revenue)', () => {
    expect(result.columns.unitPrice).toMatch(/average sales price/i);
  });

  it('3 item lines', () => expect(result.lines.length).toBe(3));

  it('[REGRESSION] gross = 276 (line total), not 11.50 (unit price) — "sales" substring bug', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    expect(h.gross).toBe(276);
    expect(h.unitPrice).toBe(11.5);
    expect(h.gross).not.toBe(h.unitPrice);
  });

  it('netExcl is populated from GST-excl column', () => {
    const h = result.lines.find(l => l.name === 'Heineken 330ml')!;
    expect(h.netExcl).toBe(240);
    expect(h.net).toBe(240);
  });
});

// ── Format B ───────────────────────────────────────────────────────────────────

describe('Format B (bustle_items)', () => {
  const result = parseSalesExport(parseCsvText(FORMAT_B_CSV));

  it('format = bustle_items, headerRowIndex = 1, gstBasis = assumed_incl', () => {
    expect(result.format).toBe('bustle_items');
    expect(result.headerRowIndex).toBe(1);
    expect(result.gstBasis).toBe('assumed_incl');
  });

  it('qty column = "Count", totalIncl = "Total Sales"', () => {
    expect(result.columns.qty).toBe('Count');
    expect(result.columns.totalIncl).toBe('Total Sales');
  });

  it('5 item lines (category rows excluded)', () => {
    expect(result.lines.length).toBe(5);
    const names = result.lines.map(l => l.name);
    expect(names).not.toContain('Food');
    expect(names).not.toContain('Wine');
    expect(names).not.toContain('No Subcategory');
  });

  it('categories list populated', () => {
    expect(result.categories).toContain('Food');
    expect(result.categories).toContain('Alcoholic');
    expect(result.categories).toContain('Wine');
  });

  it('controlTotal = 418, reconciled = true', () => {
    expect(result.controlTotal).toBe(418);
    expect(result.controlTotalReconciled).toBe(true);
  });

  it('[REGRESSION] gross = 38 (line total), not 19 (unit price) — "sales" substring bug', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    expect(a.gross).toBe(38);
    expect(a.unitPrice).toBe(19);
    expect(a.gross).not.toBe(a.unitPrice);
  });

  it('netExcl = null (no GST-excl column in Format B)', () => {
    const a = result.lines.find(l => l.name === 'Andre clouet')!;
    expect(a.netExcl).toBeNull();
  });
});

// ── Derived mode ───────────────────────────────────────────────────────────────

describe('derived mode', () => {
  const result = parseSalesExport(parseCsvText(DERIVED_CSV));

  it('all lines derived, gross = qty × unitPrice', () => {
    const h = result.lines.find(l => l.name === 'Heineken')!;
    expect(h.derived).toBe(true);
    expect(h.gross).toBe(85);
  });

  it('emits derived warning', () => {
    expect(result.warnings.some(w => /derived/i.test(w))).toBe(true);
  });
});

// ── Sync check ─────────────────────────────────────────────────────────────────

describe('sync check', () => {
  it('web-app copy is byte-for-byte identical to mobile canonical', () => {
    const webCopy = readFileSync(
      resolve(__dirname, '../utils/parseSalesExport.ts'),
      'utf8'
    );
    const canonical = readFileSync(
      resolve(__dirname, '../../../src/services/sales/parseSalesExport.ts'),
      'utf8'
    );
    expect(webCopy).toBe(canonical);
  });
});

// ── A1: kind fix ───────────────────────────────────────────────────────────────

describe('kind field', () => {
  it('bustle_rich → kind = "items"', () => {
    const result = parseSalesExport(parseCsvText(FORMAT_A_CSV));
    expect(result.format).toBe('bustle_rich');
    expect(result.kind).toBe('items');
  });

  it('bustle_items → kind = "items"', () => {
    const result = parseSalesExport(parseCsvText(FORMAT_B_CSV));
    expect(result.format).toBe('bustle_items');
    expect(result.kind).toBe('items');
  });

  it('derived (generic) → kind = "unknown"', () => {
    const result = parseSalesExport(parseCsvText(DERIVED_CSV));
    expect(result.kind).toBe('unknown');
  });
});
