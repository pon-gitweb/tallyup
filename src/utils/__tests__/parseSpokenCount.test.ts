import { parseSpokenCount } from '../parseSpokenCount';

describe('parseSpokenCount — existing cases keep working', () => {
  it('parses direct decimals', () => {
    expect(parseSpokenCount('1.5')).toBe(1.5);
  });
  it('parses half', () => {
    expect(parseSpokenCount('half')).toBe(0.5);
    expect(parseSpokenCount('a half')).toBe(0.5);
  });
  it('parses quarter', () => {
    expect(parseSpokenCount('quarter')).toBe(0.25);
    expect(parseSpokenCount('a quarter')).toBe(0.25);
  });
  it('parses "point five"', () => {
    expect(parseSpokenCount('point five')).toBe(0.5);
  });
  it('parses "one and a half"', () => {
    expect(parseSpokenCount('one and a half')).toBe(1.5);
  });
  it('parses word numbers', () => {
    expect(parseSpokenCount('twenty one')).toBe(21);
    expect(parseSpokenCount('one hundred and twenty five')).toBe(125);
  });
});

describe('parseSpokenCount — GAP 1: three quarters', () => {
  it('parses "three quarters"', () => {
    expect(parseSpokenCount('three quarters')).toBe(0.75);
  });
  it('parses "three quarter"', () => {
    expect(parseSpokenCount('three quarter')).toBe(0.75);
  });
});

describe('parseSpokenCount — GAP 2: filler-word tolerance', () => {
  it('parses "half a bottle"', () => {
    expect(parseSpokenCount('half a bottle')).toBe(0.5);
  });
  it('parses "a half please"', () => {
    expect(parseSpokenCount('a half please')).toBe(0.5);
  });
  it('parses "one and a half bottles"', () => {
    expect(parseSpokenCount('one and a half bottles')).toBe(1.5);
  });
  it('parses "three quarters of a bottle"', () => {
    expect(parseSpokenCount('three quarters of a bottle')).toBe(0.75);
  });
});

describe('parseSpokenCount — edge cases return null', () => {
  it('returns null for empty string', () => {
    expect(parseSpokenCount('')).toBeNull();
  });
  it('returns null for gibberish', () => {
    expect(parseSpokenCount('banana')).toBeNull();
  });
  it('returns null for filler-word-only input', () => {
    expect(parseSpokenCount('the')).toBeNull();
  });
});
