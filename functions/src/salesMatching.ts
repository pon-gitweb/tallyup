/**
 * Pure, stateless sales-line matching.
 * No Firestore access, no async — takes products and mappings as arguments.
 *
 * Pipeline (each step wins if it fires; later steps are never reached):
 *   1. Saved posProductMappings (operator-confirmed POS → product)
 *   2. Barcode / SKU exact match
 *   3. Exact name after normalisation (unique match only)
 *   4. Modifier-stripped token equality (unique match, ≥2 tokens after strip)
 *   5. Unknown (null)
 *
 * Diacritics are folded in this file via NFD decomposition before any comparison.
 * nameMatching.ts is not used here — its overlap score rates any short name a
 * perfect match for any longer name that contains it, which produces false
 * positives on real data (e.g. "Dirty Martini" → "Batch Brine Dirty Martini").
 */

export type MatchVia = 'mapping' | 'barcode' | 'exact' | 'modifier';

export interface SalesMatchResult {
  product: ProductLike;
  via: MatchVia;
}

export interface ProductLike {
  id: string;
  name?: string | null;
  barcode?: string | null;
  barCode?: string | null;
  bar_code?: string | null;
  sku?: string | null;
  code?: string | null;
}

export interface SalesLineInput {
  name?: string | null;
  qtySold: number;
  barcode?: string | null;
  sku?: string | null;
}

/**
 * Modifier tokens stripped from both the POS line and product names before
 * token-set comparison in step 4.  These are positional / size / brand qualifiers
 * that appear in one name but not the other without changing which product is
 * meant ("Red Door" in well → "J & B Rare"; "Kirin beer small" → "Kirin Beer";
 * "Salsa Verde" → "Batch Salsa Verde").
 *
 * Extend only with evidence from real data.  Never add a content word here —
 * "brine", "dirty", "syrup" are not modifiers; they are the identity of the product.
 */
export const MODIFIER_TOKENS = new Set([
  'batch', 'well', 'small', 'large', 'regular', 'standard',
]);

/**
 * Normalise a name for comparison:
 *   lowercase, NFD diacritics folded (é→e, í→i, …), punctuation removed,
 *   spaces collapsed.
 *
 * "Mencía" → "mencia"; "Languedoc, France" → "languedoc france".
 * This is intentionally separate from tokenizeForMatching in nameMatching.ts,
 * which strips diacritics outright (e.g. "Mencía" → "menca").
 */
function normalize(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function setsEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

function getBarcode(p: ProductLike): string {
  return ((p.barcode || p.barCode || p.bar_code) ?? '').toString().trim();
}

function getSku(p: ProductLike): string {
  return ((p.sku || p.code) ?? '').toString().trim();
}

export function matchSalesLine(
  line: SalesLineInput,
  products: ProductLike[],
  mappings: Record<string, string> = {},
): SalesMatchResult | null {
  const rawName = (line.name || '').toString().trim();
  if (!rawName) return null;

  // Step 1: saved POS → product mapping (key is lowercased raw name)
  const confirmedId = mappings[rawName.toLowerCase()];
  if (confirmedId) {
    const hit = products.find(p => p.id === confirmedId);
    if (hit) return { product: hit, via: 'mapping' };
  }

  // Step 2: barcode / SKU exact match
  const lineBarcode = (line.barcode ?? '').toString().trim();
  const lineSku = (line.sku ?? '').toString().trim();
  if (lineBarcode) {
    const hit = products.find(p => getBarcode(p) === lineBarcode);
    if (hit) return { product: hit, via: 'barcode' };
  }
  if (lineSku) {
    const hit = products.find(p => getSku(p) === lineSku);
    if (hit) return { product: hit, via: 'barcode' };
  }

  // Step 3: exact normalised name — unique match only
  const lineNorm = normalize(rawName);
  const exactMatches = products.filter(p => normalize(p.name ?? '') === lineNorm);
  if (exactMatches.length === 1) return { product: exactMatches[0], via: 'exact' };
  if (exactMatches.length > 1) return null; // ambiguous

  // Step 4: modifier-stripped token equality — unique match, ≥2 line tokens after strip
  const lineTokens = lineNorm.split(' ').filter(t => t && !MODIFIER_TOKENS.has(t));
  if (lineTokens.length >= 2) {
    const modifierMatches = products.filter(p => {
      const pTokens = normalize(p.name ?? '').split(' ').filter(t => t && !MODIFIER_TOKENS.has(t));
      return setsEqual(lineTokens, pTokens);
    });
    if (modifierMatches.length === 1) return { product: modifierMatches[0], via: 'modifier' };
  }

  return null;
}
