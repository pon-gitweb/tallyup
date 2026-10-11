/**
 * Pure, stateless sales-line matching.
 * No Firestore access, no async — takes a ProductIndex and mappings as arguments.
 *
 * Pipeline (each step wins if it fires; later steps are never reached):
 *   1. Saved posProductMappings (operator-confirmed POS → product)
 *   2. Barcode / SKU exact match
 *   3. Exact name after normalisation (unique match only)
 *   4. Modifier-stripped token equality (unique match, ≥2 tokens after strip)
 *   5. Unknown (null)
 *
 * Diacritics are folded via NFD decomposition before any comparison.
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
 *   lowercase, NFD diacritics folded (é→e, í→i, …), apostrophes deleted,
 *   all other non-alphanumeric characters replaced with a space, spaces collapsed.
 *
 * "Mencía" → "mencia"; "Languedoc, France" → "languedoc france";
 * "J&B Rare" → "j b rare"; "Coca-Cola" → "coca cola"; "Hendrick's Gin" → "hendricks gin".
 *
 * Intentionally separate from tokenizeForMatching in nameMatching.ts, which
 * strips diacritics outright (e.g. "Mencía" → "menca").
 */
function normalize(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBarcode(p: ProductLike): string {
  return ((p.barcode || p.barCode || p.bar_code) ?? '').toString().trim();
}

function getSku(p: ProductLike): string {
  return ((p.sku || p.code) ?? '').toString().trim();
}

/** True if the line has a blank or whitespace-only name and should be skipped. */
export function isBlankSalesLine(line: { name?: string | null }): boolean {
  return !(line.name || '').toString().trim();
}

export interface ProductIndex {
  byId: Map<string, ProductLike>;
  /** normalized name → products with that exact normalized name */
  byNormName: Map<string, ProductLike[]>;
  /** sorted stripped-token key → products (for step 4 modifier matching) */
  byStrippedTokens: Map<string, ProductLike[]>;
  byBarcode: Map<string, ProductLike>;
  bySku: Map<string, ProductLike>;
}

export function buildProductIndex(products: ProductLike[]): ProductIndex {
  const byId = new Map<string, ProductLike>();
  const byNormName = new Map<string, ProductLike[]>();
  const byStrippedTokens = new Map<string, ProductLike[]>();
  const byBarcode = new Map<string, ProductLike>();
  const bySku = new Map<string, ProductLike>();

  for (const p of products) {
    byId.set(p.id, p);

    const norm = normalize(p.name ?? '');
    if (norm) {
      if (!byNormName.has(norm)) byNormName.set(norm, []);
      byNormName.get(norm)!.push(p);
    }

    const stripped = norm.split(' ').filter(t => t && !MODIFIER_TOKENS.has(t));
    if (stripped.length >= 2) {
      const key = [...stripped].sort().join(' ');
      if (!byStrippedTokens.has(key)) byStrippedTokens.set(key, []);
      byStrippedTokens.get(key)!.push(p);
    }

    const barcode = getBarcode(p);
    if (barcode) byBarcode.set(barcode, p);

    const sku = getSku(p);
    if (sku) bySku.set(sku, p);
  }

  return { byId, byNormName, byStrippedTokens, byBarcode, bySku };
}

export function matchSalesLine(
  line: SalesLineInput,
  index: ProductIndex,
  mappings: Record<string, string> = {},
): SalesMatchResult | null {
  const rawName = (line.name || '').toString().trim();
  if (!rawName) return null;

  // Step 1: saved POS → product mapping (key is lowercased raw name)
  const confirmedId = mappings[rawName.toLowerCase()];
  if (confirmedId) {
    const hit = index.byId.get(confirmedId);
    if (hit) return { product: hit, via: 'mapping' };
  }

  // Step 2: barcode / SKU exact match
  const lineBarcode = (line.barcode ?? '').toString().trim();
  const lineSku = (line.sku ?? '').toString().trim();
  if (lineBarcode) {
    const hit = index.byBarcode.get(lineBarcode);
    if (hit) return { product: hit, via: 'barcode' };
  }
  if (lineSku) {
    const hit = index.bySku.get(lineSku);
    if (hit) return { product: hit, via: 'barcode' };
  }

  // Step 3: exact normalised name — unique match only
  const lineNorm = normalize(rawName);
  const exactMatches = index.byNormName.get(lineNorm) ?? [];
  if (exactMatches.length === 1) return { product: exactMatches[0], via: 'exact' };
  if (exactMatches.length > 1) return null; // ambiguous

  // Step 4: modifier-stripped token equality — unique match, ≥2 line tokens after strip
  const lineTokens = lineNorm.split(' ').filter(t => t && !MODIFIER_TOKENS.has(t));
  if (lineTokens.length >= 2) {
    const key = [...lineTokens].sort().join(' ');
    const modifierMatches = index.byStrippedTokens.get(key) ?? [];
    if (modifierMatches.length === 1) return { product: modifierMatches[0], via: 'modifier' };
  }

  return null;
}
