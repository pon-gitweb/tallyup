// Pure, stateless string-matching utilities for supplier and product name resolution.
// No Firestore access, no async — matching math only, reusable across both domains.

/**
 * Tokenises a name for overlap-coefficient matching.
 *   1. Lowercase, strip non-alphanumeric-except-space, collapse whitespace.
 *   2. Split "pinet24" → ["pinet", "24"]  (trailing-digit splitting).
 *   3. Normalise bare 2-digit tokens to 4-digit years: "24" → "2024".
 */
export function tokenizeForMatching(s: string): Set<string> {
  const normalised = (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalised.split(" ").filter(Boolean);
  const tokens: string[] = [];

  for (const word of words) {
    const m = word.match(/^([a-z]+)(\d+)$/);
    if (m) {
      tokens.push(m[1], m[2]);
    } else {
      tokens.push(word);
    }
  }

  return new Set(tokens.map(t => (/^\d{2}$/.test(t) ? "20" + t : t)));
}

/**
 * Overlap coefficient: |A ∩ B| / min(|A|, |B|).
 * Answers "does the shorter token set appear in the longer one?" — the right
 * question when one name is a genuinely terser subset of the other (e.g. a
 * terse invoice line vs. a richer product catalogue name).
 * Edge cases mirror tokenJaccard in supplierResolution.ts:
 *   both empty → 1, one empty → 0.
 */
export function overlapCoefficient(a: string, b: string): number {
  const ta = tokenizeForMatching(a);
  const tb = tokenizeForMatching(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / Math.min(ta.size, tb.size);
}

// Longest-first ordering matters: "Pty Ltd" must be tried before bare "Pty".
const LEGAL_SUFFIX_RE = /\s*(Limited|Pty Ltd|Ltd\.|Ltd|Inc\.|Inc|Pty|LLC|Co\.|Co|Company|Group)\s*$/i;

/**
 * Strips a trailing legal entity suffix from a supplier name before tokenising.
 * "Mineral Limited" → "Mineral", "DB Pty Ltd" → "DB", "Wine Co." → "Wine".
 * Call this on both sides before tokenising when comparing supplier names.
 * Never used for product-name matching.
 */
export function stripLegalSuffix(s: string): string {
  return s.replace(LEGAL_SUFFIX_RE, "").trim();
}

/**
 * Guards against high-score matches on dangerously small token sets.
 *
 * A 2+-token match at score ≥ 0.85 is always accepted — there's enough
 * overlapping signal to be confident.
 *
 * A 1-token match at score ≥ 0.85 (overlap = 1.0 by arithmetic) is only
 * accepted if that single shared token is ≥ 6 characters. Rationale: generic
 * short tokens ("wine", "beer", "bar", "fresh", "wines" — all ≤ 5 chars)
 * appear in many unrelated names and produce false positives at overlap = 1.0.
 * At 6+ characters, tokens are substantially more entity-specific in the NZ
 * hospitality space, while still catching legitimate short names like "Bidfood"
 * (7) or "Mineral" (7). Common 6-char words ("market", "drinks") remain a
 * small residual risk, but it's far lower than the 1-5 char band.
 */
export function isReliableMatch(
  tokensA: Set<string>,
  tokensB: Set<string>,
  score: number,
): boolean {
  if (score < 0.85) return false;
  const minSize = Math.min(tokensA.size, tokensB.size);
  if (minSize >= 2) return true;
  if (minSize === 0) return false;
  // minSize === 1: score ≥ 0.85 guarantees exactly one token in common.
  const sharedToken = [...tokensA].find(t => tokensB.has(t));
  return sharedToken !== undefined && sharedToken.length >= 6;
}
