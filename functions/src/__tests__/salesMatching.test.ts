import { matchSalesLine, ProductLike } from '../salesMatching';
import { PRODUCTS, GOLDEN_CASES } from './fixtures/salesMatching.golden';

// ── Golden fixture ─────────────────────────────────────────────────────────────

describe('matchSalesLine — golden fixture', () => {
  for (const tc of GOLDEN_CASES) {
    const label = tc.expectedProductName ?? 'UNKNOWN';
    test(`"${tc.line.name}" → ${label}`, () => {
      const result = matchSalesLine(tc.line, PRODUCTS);
      expect(result?.product.name ?? null).toBe(tc.expectedProductName);
    });
  }
});

// ── Extra unit tests ───────────────────────────────────────────────────────────

describe('matchSalesLine — unit tests', () => {
  test('empty name returns null', () => {
    const products: ProductLike[] = [{ id: 'p1', name: 'Foo' }];
    expect(matchSalesLine({ name: '',    qtySold: 1 }, products)).toBeNull();
    expect(matchSalesLine({ name: '   ', qtySold: 1 }, products)).toBeNull();
  });

  test('two products normalising to the same name → unknown (ambiguous)', () => {
    const products: ProductLike[] = [
      { id: 'p1', name: 'Foo Bar' },
      { id: 'p2', name: 'FOO BAR' },   // normalises to "foo bar" — same as p1
    ];
    expect(matchSalesLine({ name: 'Foo Bar', qtySold: 1 }, products)).toBeNull();
  });

  test('saved mapping beats exact name match', () => {
    const products: ProductLike[] = [
      { id: 'p1', name: 'Foo Bar' },
      { id: 'p2', name: 'Different Product' },
    ];
    const mappings = { 'foo bar': 'p2' };
    const result = matchSalesLine({ name: 'Foo Bar', qtySold: 1 }, products, mappings);
    expect(result?.product.id).toBe('p2');
    expect(result?.via).toBe('mapping');
  });

  test('barcode beats exact name match', () => {
    const products: ProductLike[] = [
      { id: 'p-barcode', name: 'Different Name', barcode: 'BC123' },
      { id: 'p-name',    name: 'Matching Name' },
    ];
    const result = matchSalesLine(
      { name: 'Matching Name', qtySold: 1, barcode: 'BC123' },
      products,
    );
    expect(result?.product.id).toBe('p-barcode');
    expect(result?.via).toBe('barcode');
  });
});
