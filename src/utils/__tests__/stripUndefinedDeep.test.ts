import { stripUndefinedDeep } from '../stripUndefinedDeep';

// Simulate the class instances that Firestore SDK uses internally.
class FakeTimestamp {
  constructor(public _seconds: number, public _nanoseconds: number) {}
}
class FakeFieldValue {
  constructor(public _methodName: string) {}
}

describe('stripUndefinedDeep — plain object stripping', () => {
  it('removes top-level undefined properties', () => {
    const input = { a: 1, b: undefined, c: 'hello' };
    const result = stripUndefinedDeep(input);
    expect(result).toEqual({ a: 1, c: 'hello' });
    expect('b' in result).toBe(false);
  });

  it('removes nested undefined properties inside plain objects', () => {
    const input = { outer: { x: 1, y: undefined }, z: 2 };
    expect(stripUndefinedDeep(input)).toEqual({ outer: { x: 1 }, z: 2 });
  });

  it('strips undefined inside arrays of plain objects', () => {
    const input = { items: [{ a: 1, b: undefined }, { a: 2 }] };
    expect(stripUndefinedDeep(input)).toEqual({ items: [{ a: 1 }, { a: 2 }] });
  });

  it('preserves null (Firestore null is valid)', () => {
    expect(stripUndefinedDeep({ a: null })).toEqual({ a: null });
  });

  it('preserves false and 0 (falsy but not undefined)', () => {
    expect(stripUndefinedDeep({ flag: false, count: 0, name: '' }))
      .toEqual({ flag: false, count: 0, name: '' });
  });

  it('returns primitives unchanged', () => {
    expect(stripUndefinedDeep(42)).toBe(42);
    expect(stripUndefinedDeep('hello')).toBe('hello');
    expect(stripUndefinedDeep(null)).toBeNull();
  });

  it('does not mutate the original object', () => {
    const input: any = { a: 1, b: undefined };
    stripUndefinedDeep(input);
    expect('b' in input).toBe(true);
  });
});

describe('stripUndefinedDeep — class instances returned by identity', () => {
  it('Date is returned by identity (not destructured to {})', () => {
    const d = new Date('2024-01-15');
    const payload = { completedAt: d, name: 'test', dropped: undefined };
    const result = stripUndefinedDeep(payload);
    expect(result.completedAt).toBe(d); // same reference
    expect(result.completedAt).toBeInstanceOf(Date);
    expect('dropped' in result).toBe(false);
  });

  it('Firestore Timestamp class instance is returned by identity', () => {
    const ts = new FakeTimestamp(1700000000, 0);
    const payload = { createdAt: ts, ok: true, gone: undefined };
    const result = stripUndefinedDeep(payload);
    expect(result.createdAt).toBe(ts);
    expect(result.createdAt).toBeInstanceOf(FakeTimestamp);
    expect('gone' in result).toBe(false);
  });

  it('serverTimestamp() sentinel (class instance) is returned by identity', () => {
    const sentinel = new FakeFieldValue('serverTimestamp');
    const payload = { updatedAt: sentinel, val: 1, x: undefined };
    const result = stripUndefinedDeep(payload);
    expect(result.updatedAt).toBe(sentinel);
    expect(result.updatedAt).toBeInstanceOf(FakeFieldValue);
    expect('x' in result).toBe(false);
  });

  it('nested plain object with class-instance value: strips undefined, preserves instance', () => {
    const d = new Date();
    const sentinel = new FakeFieldValue('serverTimestamp');
    const payload = {
      meta: { completedAt: d, serverTs: sentinel, dropped: undefined },
      items: [{ name: 'Beer', ts: new FakeTimestamp(1, 0), gone: undefined }],
    };
    const result = stripUndefinedDeep(payload);
    expect(result.meta.completedAt).toBe(d);
    expect(result.meta.serverTs).toBe(sentinel);
    expect('dropped' in result.meta).toBe(false);
    expect(result.items[0].ts).toBeInstanceOf(FakeTimestamp);
    expect('gone' in result.items[0]).toBe(false);
  });

  it('null-prototype plain object: still recurses into it', () => {
    const input = Object.assign(Object.create(null), { a: 1, b: undefined });
    const result = stripUndefinedDeep(input) as any;
    expect(result.a).toBe(1);
    expect('b' in result).toBe(false);
  });
});
