// Mirrors functions/src/nameMatching.ts — update both if you change the logic.
// stripLegalSuffix is intentionally omitted (not needed for product-name matching).

export function tokenizeForMatching(s: string): Set<string> {
  const normalised = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalised.split(' ').filter(Boolean);
  const tokens: string[] = [];

  for (const word of words) {
    const m = word.match(/^([a-z]+)(\d+)$/);
    if (m) {
      tokens.push(m[1], m[2]);
    } else {
      tokens.push(word);
    }
  }

  return new Set(tokens.map(t => (/^\d{2}$/.test(t) ? '20' + t : t)));
}

export function overlapCoefficient(a: string, b: string): number {
  const ta = tokenizeForMatching(a);
  const tb = tokenizeForMatching(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / Math.min(ta.size, tb.size);
}

export function isReliableMatch(tokensA: Set<string>, tokensB: Set<string>, score: number): boolean {
  if (score < 0.85) return false;
  const minSize = Math.min(tokensA.size, tokensB.size);
  if (minSize >= 2) return true;
  if (minSize === 0) return false;
  // minSize === 1: score ≥ 0.85 guarantees exactly one token in common.
  const sharedToken = [...tokensA].find(t => tokensB.has(t));
  return sharedToken !== undefined && sharedToken.length >= 6;
}
