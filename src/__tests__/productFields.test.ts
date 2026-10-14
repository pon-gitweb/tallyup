import { getParLevel } from '../utils/productFields';

describe('getParLevel', () => {
  it('prefers parLevel over par when both are set', () => {
    expect(getParLevel({ parLevel: 10, par: 5 })).toBe(10);
  });

  it('reads par when parLevel is missing', () => {
    expect(getParLevel({ par: 6 })).toBe(6);
  });

  it('reads parLevel when par is missing', () => {
    expect(getParLevel({ parLevel: 8 })).toBe(8);
  });

  it('returns null when neither is set', () => {
    expect(getParLevel({})).toBeNull();
    expect(getParLevel(null)).toBeNull();
    expect(getParLevel(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(getParLevel({ par: NaN })).toBeNull();
    expect(getParLevel({ parLevel: NaN })).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(getParLevel({ par: 'abc' })).toBeNull();
  });

  it('handles numeric string values', () => {
    expect(getParLevel({ par: '12' })).toBe(12);
  });
});
