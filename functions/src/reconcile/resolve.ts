/**
 * Shared mergedInto chain resolver.
 * No Firebase imports.
 */

/**
 * Resolve a productId through the mergedInto map (cycle-safe, max 10 hops).
 * Returns the survivor ID, or the original ID if no entry or a cycle is detected.
 */
export function resolveId(id: string, mergedInto: Record<string, string>): string {
  const visited = new Set<string>();
  let cur = id;
  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(cur)) return id;
    visited.add(cur);
    const next = mergedInto[cur];
    if (!next) return cur;
    cur = next;
  }
  return id;
}
