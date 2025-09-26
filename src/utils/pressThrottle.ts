export const PATCH1_THROTTLE_ENABLED = true;

// Factory returns a throttled wrapper. Independent bucket per factory call.
const makeThrottle = (ms = 700) => {
  let last = 0;
  return <T extends (...args: any[]) => any>(fn: T) =>
    (...args: Parameters<T>) => {
      if (!PATCH1_THROTTLE_ENABLED) return fn(...args as any);
      const now = Date.now();
      if (now - last < ms) return;
      last = now;
      return fn(...args as any);
    };
};

// Two simple presets:
export const throttleNav = makeThrottle(600);
export const throttleAction = makeThrottle(800);
