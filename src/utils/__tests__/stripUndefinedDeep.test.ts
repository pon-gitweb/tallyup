import { stripUndefinedDeep } from '../stripUndefinedDeep';

describe('stripUndefinedDeep', () => {
  it('removes top-level undefined properties', () => {
    const input = { a: 1, b: undefined, c: 'hello' };
    expect(stripUndefinedDeep(input)).toEqual({ a: 1, c: 'hello' });
    expect('b' in stripUndefinedDeep(input)).toBe(false);
  });

  it('removes nested undefined properties', () => {
    const input = { outer: { x: 1, y: undefined }, z: 2 };
    expect(stripUndefinedDeep(input)).toEqual({ outer: { x: 1 }, z: 2 });
  });

  it('strips undefined inside arrays', () => {
    const input = { items: [{ a: 1, b: undefined }, { a: 2 }] };
    expect(stripUndefinedDeep(input)).toEqual({ items: [{ a: 1 }, { a: 2 }] });
  });

  it('preserves null (Firestore null is valid)', () => {
    const input = { a: null, b: 1 };
    expect(stripUndefinedDeep(input)).toEqual({ a: null, b: 1 });
  });

  it('preserves false and 0 (falsy but not undefined)', () => {
    const input = { flag: false, count: 0, name: '' };
    expect(stripUndefinedDeep(input)).toEqual({ flag: false, count: 0, name: '' });
  });

  it('returns primitives unchanged', () => {
    expect(stripUndefinedDeep(42)).toBe(42);
    expect(stripUndefinedDeep('hello')).toBe('hello');
    expect(stripUndefinedDeep(null)).toBeNull();
  });

  it('handles deeply nested objects', () => {
    const input = { a: { b: { c: undefined, d: 4 } } };
    expect(stripUndefinedDeep(input)).toEqual({ a: { b: { d: 4 } } });
  });

  it('does not mutate the original object', () => {
    const input = { a: 1, b: undefined };
    const copy = { ...input };
    stripUndefinedDeep(input);
    expect('b' in input).toBe(true); // original unmodified
    expect(input).toEqual(copy);
  });

  it('snapshot payload: ambiguous item with ambiguousName present — no undefined survives', () => {
    const item = {
      productId: 'p1',
      name: 'Beer',
      varianceReliable: false,
      ambiguousName: true,
      areas: [{ areaId: 'a1', areaItemId: 'i1', actualClosing: 5 }],
    };
    const payload = stripUndefinedDeep({ index: 0, items: [item] });
    expect(hasUndefinedDeep(payload)).toBe(false);
  });

  it('snapshot payload: non-ambiguous item with no ambiguousName — no undefined survives', () => {
    const item = {
      productId: 'p1',
      name: 'Wine',
      varianceReliable: true,
      areas: [{ areaId: 'a1', areaItemId: 'i1', actualClosing: 3 }],
    };
    const payload = stripUndefinedDeep({ index: 0, items: [item] });
    expect(hasUndefinedDeep(payload)).toBe(false);
  });
});

function hasUndefinedDeep(obj: unknown): boolean {
  if (Array.isArray(obj)) return obj.some(hasUndefinedDeep);
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj as object).some(v => v === undefined || hasUndefinedDeep(v));
  }
  return false;
}
