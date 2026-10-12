const { extractAddDocKeysFromSource } = require('../../scripts/check-rules-payloads');
const ts   = require('typescript');
const path = require('path');
const fs   = require('fs');

const ALLOWED_8 = new Set([
  'source', 'report', 'periodStart', 'periodEnd',
  'overlappingCycles', 'allocationMethod', 'status', 'createdAt',
]);

function violations(keys) {
  return keys.filter(k => !ALLOWED_8.has(k));
}

// Build a source string with the given property names as top-level keys
// inside addDoc(collection(..., 'salesReports'), { ... }).
// The value for 'report' is always a nested object literal to exercise the
// "keys after nested object" path that defeated the old regex approach.
function makeSource(keys) {
  const props = keys.map(k =>
    k === 'report'
      ? `  report: { lines: [], meta: { kind: 'items' } },`
      : `  ${k}: someValue,`
  ).join('\n');
  return `
    import { addDoc, collection } from 'firebase/firestore';
    async function save() {
      await addDoc(collection(db, 'venues', venueId, 'salesReports'), {
${props}
      });
    }
  `;
}

const BASE_KEYS = [
  'source', 'report', 'periodStart', 'periodEnd',
  'overlappingCycles', 'allocationMethod', 'status', 'createdAt',
];

describe('extractAddDocKeysFromSource — salesReports', () => {
  test('valid 8-key payload returns all keys with no error', () => {
    const src = makeSource(BASE_KEYS);
    const [result] = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(result.error).toBeNull();
    expect(result.keys).toEqual(BASE_KEYS);
    expect(violations(result.keys)).toHaveLength(0);
  });

  test('extra key BEFORE report is captured (script would FAIL)', () => {
    const keys = ['source', 'forbiddenBeforeReport', 'report', 'periodStart',
                  'periodEnd', 'overlappingCycles', 'allocationMethod', 'status', 'createdAt'];
    const src = makeSource(keys);
    const [result] = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(result.error).toBeNull();
    expect(result.keys).toContain('forbiddenBeforeReport');
    expect(violations(result.keys)).toContain('forbiddenBeforeReport');
  });

  test('extra key AFTER report (nested object) is captured (script would FAIL)', () => {
    // This is the exact bug the rewrite fixes: the old regex stopped at the
    // first } inside the object literal, so keys after report: {...} were missed.
    const src = `
      async function save() {
        await addDoc(collection(db, 'venues', id, 'salesReports'), {
          source: x,
          report: { lines: [], meta: { kind: 'items' } },
          sourceFormat: 'bustle_items',
          periodStart: null,
          periodEnd: null,
          overlappingCycles: [],
          allocationMethod: 'none',
          status: 'active',
          createdAt: y,
        });
      }
    `;
    const [result] = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(result.error).toBeNull();
    expect(result.keys).toContain('report');
    expect(result.keys).toContain('sourceFormat');
    expect(violations(result.keys)).toContain('sourceFormat');
  });

  test('extra key as LAST property is captured (script would FAIL)', () => {
    const keys = [...BASE_KEYS, 'extraAtEnd'];
    const src = makeSource(keys);
    const [result] = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(result.error).toBeNull();
    expect(result.keys).toHaveLength(9);
    expect(result.keys[8]).toBe('extraAtEnd');
    expect(violations(result.keys)).toContain('extraAtEnd');
  });

  test('spread element sets error (script would FAIL)', () => {
    const src = `
      async function save() {
        await addDoc(collection(db, 'venues', id, 'salesReports'), {
          source: x,
          ...extraProps,
          createdAt: y,
        });
      }
    `;
    const [result] = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(result.error).toMatch(/spread/i);
  });

  test('does not match addDoc calls for a different collection', () => {
    const src = makeSource(BASE_KEYS);
    const results = extractAddDocKeysFromSource(src, 'invoices', ts.ScriptKind.TS);
    expect(results).toHaveLength(0);
  });

  test('real storeSalesReport.ts passes with exactly the 8 allowed keys', () => {
    const filePath = path.resolve(__dirname, '../../src/services/sales/storeSalesReport.ts');
    const src = fs.readFileSync(filePath, 'utf8');
    const results = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TS);
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.error).toBeNull();
    expect(result.keys).toHaveLength(8);
    expect(new Set(result.keys)).toEqual(ALLOWED_8);
  });

  test('real ImportPage.tsx passes with exactly the 8 allowed keys', () => {
    const filePath = path.resolve(__dirname, '../../web-app/src/pages/ImportPage.tsx');
    const src = fs.readFileSync(filePath, 'utf8');
    const results = extractAddDocKeysFromSource(src, 'salesReports', ts.ScriptKind.TSX);
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.error).toBeNull();
    expect(result.keys).toHaveLength(8);
    expect(new Set(result.keys)).toEqual(ALLOWED_8);
  });
});
