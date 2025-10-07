import { jest } from '@jest/globals';
jest.useFakeTimers();
describe('pressThrottle', () => {
  const { throttleAction } = require('../src/utils/pressThrottle');
  test('allows first call, suppresses until window elapses', () => {
    const fn = jest.fn();
    const throttled = throttleAction(fn, 500);
    throttled(); throttled(); throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(499);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
