// @ts-nocheck
/**
 * Lightweight debug logger for Suggested Orders.
 * Safe to include in production; logs only in __DEV__.
 */
export function logSuggestShape(tag: string, value: any) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      // Avoid giant objects crashing logs
      const preview = Array.isArray(value)
        ? { type: 'array', len: value.length }
        : (value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).slice(0, 8).map(k => [k, value[k]]))
            : value);
      console.log(`[SO DEBUG] ${tag}`, preview);
    } catch {
      // noop
    }
  }
}
