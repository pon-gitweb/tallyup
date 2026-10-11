import { matchSalesLine, buildProductIndex, isBlankSalesLine, ProductLike } from '../salesMatching';
import { PRODUCTS, GOLDEN_CASES } from './fixtures/salesMatching.golden';

const INDEX = buildProductIndex(PRODUCTS);

// ── Golden fixture ─────────────────────────────────────────────────────────────

describe('matchSalesLine — golden fixture', () => {
  for (const tc of GOLDEN_CASES) {
    const label = tc.expectedProductName ?? 'UNKNOWN';
    test(`"${tc.line.name}" → ${label}`, () => {
      const result = matchSalesLine(tc.line, INDEX);
      expect(result?.product.name ?? null).toBe(tc.expectedProductName);
    });
  }
});

// ── Extra unit tests ───────────────────────────────────────────────────────────

describe('matchSalesLine — unit tests', () => {
  test('empty name returns null', () => {
    const products: ProductLike[] = [{ id: 'p1', name: 'Foo' }];
    const idx = buildProductIndex(products);
    expect(matchSalesLine({ name: '',    qtySold: 1 }, idx)).toBeNull();
    expect(matchSalesLine({ name: '   ', qtySold: 1 }, idx)).toBeNull();
  });

  test('two products normalising to the same name → unknown (ambiguous)', () => {
    const products: ProductLike[] = [
      { id: 'p1', name: 'Foo Bar' },
      { id: 'p2', name: 'FOO BAR' },   // normalises to "foo bar" — same as p1
    ];
    const idx = buildProductIndex(products);
    expect(matchSalesLine({ name: 'Foo Bar', qtySold: 1 }, idx)).toBeNull();
  });

  test('saved mapping beats exact name match', () => {
    const products: ProductLike[] = [
      { id: 'p1', name: 'Foo Bar' },
      { id: 'p2', name: 'Different Product' },
    ];
    const mappings = { 'foo bar': 'p2' };
    const idx = buildProductIndex(products);
    const result = matchSalesLine({ name: 'Foo Bar', qtySold: 1 }, idx, mappings);
    expect(result?.product.id).toBe('p2');
    expect(result?.via).toBe('mapping');
  });

  test('barcode beats exact name match', () => {
    const products: ProductLike[] = [
      { id: 'p-barcode', name: 'Different Name', barcode: 'BC123' },
      { id: 'p-name',    name: 'Matching Name' },
    ];
    const idx = buildProductIndex(products);
    const result = matchSalesLine(
      { name: 'Matching Name', qtySold: 1, barcode: 'BC123' },
      idx,
    );
    expect(result?.product.id).toBe('p-barcode');
    expect(result?.via).toBe('barcode');
  });
});

// ── isBlankSalesLine ───────────────────────────────────────────────────────────

describe('isBlankSalesLine', () => {
  test('blank string is blank', () => {
    expect(isBlankSalesLine({ name: '' })).toBe(true);
  });

  test('whitespace-only is blank', () => {
    expect(isBlankSalesLine({ name: '   ' })).toBe(true);
  });

  test('null is blank', () => {
    expect(isBlankSalesLine({ name: null })).toBe(true);
  });

  test('undefined is blank', () => {
    expect(isBlankSalesLine({})).toBe(true);
  });

  test('non-empty name is not blank', () => {
    expect(isBlankSalesLine({ name: 'Guinness' })).toBe(false);
  });

  test('name with leading whitespace is not blank', () => {
    expect(isBlankSalesLine({ name: '  Guinness' })).toBe(false);
  });
});
