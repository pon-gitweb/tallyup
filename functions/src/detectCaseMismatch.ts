/**
 * detectCaseMismatch — pack-size detection for invoice price changes.
 *
 * Two exported functions:
 *   parsePackUnits(name)  — deterministic pack-size extraction from a product name
 *   detectCaseMismatch(input) — decides whether a price jump looks like a case-price error
 */

export interface PackUnitsResult {
  units: number;
  source: 'multiplied' | 'count' | 'explicit';
}

/**
 * Extracts pack size from a product name string.
 * Conservative: returns null when the result would be ambiguous or outside [2, 96].
 * Never infers from price.
 *
 * Handled patterns (case-insensitive):
 *   "4x6", "4 x 6", "4×6"         → 4*6 = 24  (both sides pure numbers)
 *   "24 x 330ml", "12x375ml"       → 24, 12    (second side has a volume/weight unit)
 *   "case of 24", "24 per case"    → 24
 *   "24 pack", "24pk", "x24"       → 24
 *   "ctn 24", "24 cases"           → 24
 */
export function parsePackUnits(name: string): PackUnitsResult | null {
  const s = name.toLowerCase();

  // ── NxM patterns ────────────────────────────────────────────────────────────
  // Iterates all NxM matches (g flag) so a skipped match doesn't block a later good one.
  // Skips when the second number's suffix is:
  //   '%'  — alcohol percentage e.g. "6 x 4.5% 330ml" (would multiply to wrong answer)
  //   DIM  — physical size e.g. "30x50cm", "6x6 inch", "2x4ft"
  // Volume/weight suffix on the second side → first number is the pack count.
  // No suffix on either side → multiply both numbers.
  const VOLUME_SUFFIX = /^(ml|cl|fl|oz|l\b|ltr\b|kg\b|g\b|mg\b)/i;
  const DIM_SUFFIX = /^(cm\b|mm\b|m\b|in\b|inch\b|inches\b|ft\b|yd\b|")/i;
  // Also captures % and " so we can detect alcohol marks and inch symbols
  const xRe = /(?<![a-z\d])(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*([%a-z"][a-z%"]*)?/g;
  for (const xMatch of s.matchAll(xRe)) {
    const a = parseInt(xMatch[1], 10);
    const bRaw = xMatch[2];
    const suffix = xMatch[3] ?? '';
    if (suffix.startsWith('%')) continue; // "6 x 4.5%" — skip, may find better match later
    if (DIM_SUFFIX.test(suffix)) continue; // physical dimension — skip
    if (VOLUME_SUFFIX.test(suffix)) {
      // "24 x 330ml" → pack count is a
      if (a >= 2 && a <= 96) return { units: a, source: 'count' };
    } else {
      // "4 x 6" → multiply
      const b = parseInt(bRaw, 10);
      const product = a * b;
      if (product >= 2 && product <= 96) return { units: product, source: 'multiplied' };
    }
  }

  // ── Explicit count words ─────────────────────────────────────────────────────
  const EXPLICIT: Array<RegExp> = [
    /\bcase\s+of\s+(\d+)/,
    /(\d+)\s+per\s+case\b/,
    /\bctn\s+(\d+)/,
    /(\d+)\s*pk\b/,
    /(\d+)\s+pack\b/,
    /\bx\s*(\d+)(?!\.\d)\b/,  // "x24"; (?!\.\d) avoids matching "x 4" from "x 4.5%"
    /(\d+)\s+cases?\b/,
  ];
  for (const re of EXPLICIT) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 96) return { units: n, source: 'explicit' };
    }
  }

  return null;
}

// ── detectCaseMismatch ────────────────────────────────────────────────────────

export type CaseMismatchReason = 'name_pack' | 'case_size' | 'ratio_candidate' | 'big_jump';

export interface CaseMismatchResult {
  flag: boolean;
  guess: number | null;
  reason: CaseMismatchReason | null;
  correctedUnitPrice: number | null;
  correctedChangePercent: number | null;
}

/** Standard pack sizes used for the ratio_candidate and big_jump rules. */
const RATIO_CANDIDATES = [4, 6, 8, 10, 12, 15, 18, 20, 24, 30, 36, 48] as const;

function nearestCandidate(ratio: number): number {
  return RATIO_CANDIDATES.reduce((best, c) =>
    Math.abs(ratio - c) < Math.abs(ratio - best) ? c : best
  );
}

/**
 * Decides whether a price jump looks like a case-price error.
 *
 * Priority:
 *   1. name_pack  — parsePackUnits(name) gives N, and ratio > sqrt(N)
 *   2. case_size  — product.caseSize C is known, and ratio > sqrt(C)
 *   3. ratio_candidate — ratio within 15% of a standard pack size
 *   4. big_jump   — ratio >= 4 with no closer candidate
 *
 * Guards:
 *   - Never flags a change of 50% or less (ratio ≤ 1.5).
 *   - Never flags a decrease (ratio < 1).
 *   - Increases only.
 */
export function detectCaseMismatch(input: {
  unitPrice: number;
  existing: number;
  name: string;
  productCaseSize?: number | null;
}): CaseMismatchResult {
  const { unitPrice, existing, name, productCaseSize } = input;
  const noFlag: CaseMismatchResult = { flag: false, guess: null, reason: null, correctedUnitPrice: null, correctedChangePercent: null };

  if (!Number.isFinite(unitPrice) || !Number.isFinite(existing) || existing <= 0 || unitPrice <= 0) {
    return noFlag;
  }

  const ratio = unitPrice / existing;

  // Never flag decreases or changes of ≤ 50%
  if (ratio <= 1.5) return noFlag;

  const makeFlag = (guess: number, reason: CaseMismatchReason): CaseMismatchResult => {
    const correctedUnitPrice = unitPrice / guess;
    const correctedChangePercent =
      Math.round(((correctedUnitPrice - existing) / existing) * 10000) / 100;
    return { flag: true, guess, reason, correctedUnitPrice, correctedChangePercent };
  };

  // 1. name_pack: name encodes N, and ratio > sqrt(N)
  const parsed = parsePackUnits(name);
  if (parsed && parsed.units > 1 && ratio > Math.sqrt(parsed.units)) {
    return makeFlag(parsed.units, 'name_pack');
  }

  // 2. case_size: product already has a known caseSize, ratio > sqrt(C)
  if (typeof productCaseSize === 'number' && productCaseSize > 1 && ratio > Math.sqrt(productCaseSize)) {
    return makeFlag(productCaseSize, 'case_size');
  }

  // 3. ratio_candidate: ratio within 15% of a standard pack size
  const nearest = nearestCandidate(ratio);
  if (Math.abs(ratio - nearest) / nearest <= 0.15) {
    return makeFlag(nearest, 'ratio_candidate');
  }

  // 4. big_jump: ratio >= 4 with no close candidate match
  if (ratio >= 4) {
    return makeFlag(nearest, 'big_jump');
  }

  return noFlag;
}

// ── buildCaseMismatchFields ───────────────────────────────────────────────────

export interface CaseMismatchFields {
  possibleCaseMismatch?: boolean;
  caseMismatchGuess?: number | null;
  correctedUnitPrice?: number | null;
  correctedChangePercent?: number | null;
  caseMismatchReason?: CaseMismatchReason | null;
}

/**
 * Derives the case-mismatch fields to spread into a ProposedAction.
 * Tries the invoice LINE name first (which often has pack notation like "4x6"),
 * then falls back to the product name. Returns {} when no mismatch is detected.
 */
export function buildCaseMismatchFields(input: {
  lineName: string;
  productName: string;
  unitPrice: number;
  existing: number;
  productCaseSize?: number | null;
}): CaseMismatchFields {
  const { lineName, productName, unitPrice, existing, productCaseSize } = input;
  const parsedFromLine = parsePackUnits(lineName);
  const name = parsedFromLine ? lineName : productName;
  const result = detectCaseMismatch({ unitPrice, existing, name, productCaseSize });
  if (!result.flag) return {};
  return {
    possibleCaseMismatch: true,
    caseMismatchGuess: result.guess,
    correctedUnitPrice: result.correctedUnitPrice,
    correctedChangePercent: result.correctedChangePercent,
    caseMismatchReason: result.reason,
  };
}
