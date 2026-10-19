/**
 * Pure per-line matching logic: given pre-loaded indexes and recipe docs,
 * classify every POS sales line into matches, recipeDeductions, ignored or unknowns.
 *
 * No Firestore access — all data is passed in. Loading and caching recipe docs
 * remains the responsibility of the caller (matchAndStoreSalesLines in api.ts).
 */

import { matchSalesLine, buildProductIndex, isBlankSalesLine, ProductIndex } from './salesMatching';
import { stockUnitsPerSale, ingredientStockQty, MappingDoc } from './mappingConversion';

export { buildProductIndex };

export interface SalesLine {
  name?: string | null;
  qtySold: number;
  gross?: number | null;
  barcode?: string | null;
  sku?: string | null;
}

export interface ClassifyCounts {
  total: number;
  totalQtySold: number;
  matched: number;
  unknowns: number;
  recipeMatched: number;
  recipeMissing: number;
  ignored: number;
  unconvertible: number;
}

export interface ClassifyResult {
  matches: any[];
  recipeDeductions: any[];
  ignored: any[];
  unknowns: any[];
  counts: ClassifyCounts;
}

/**
 * Classify every line in `lines` into one of four outcomes:
 *   - matches         direct product match (via mapping, barcode, exact name, or modifier)
 *   - recipeDeductions  expanded recipe ingredient entries (one entry per ingredient × serve)
 *   - ignored         skipped mappings
 *   - unknowns        no match found, or recipe doc absent (reason 'recipe_missing')
 *
 * The four outcome qtySold values always sum to counts.totalQtySold.
 */
export function classifySalesLines(
  lines: SalesLine[],
  productIndex: ProductIndex,
  confirmedMappings: Record<string, string>,
  fullMappings: Record<string, MappingDoc>,
  recipesById: Record<string, any | null>,
  productById: Record<string, any>,
): ClassifyResult {
  const matches: any[] = [];
  const recipeDeductions: any[] = [];
  const ignored: any[] = [];
  const unknowns: any[] = [];
  let unconvertibleCount = 0;
  let recipeMissingCount = 0;

  for (const ln of lines) {
    if (isBlankSalesLine(ln)) continue;

    const lineKey = (ln.name || '').toLowerCase();
    const mapping = fullMappings[lineKey];

    // ── Skipped mapping ───────────────────────────────────────────────────────
    if (mapping?.mappingType === 'skipped') {
      ignored.push({ name: ln.name, qtySold: ln.qtySold });
      continue;
    }

    // ── Recipe mapping ────────────────────────────────────────────────────────
    if (mapping?.recipeId) {
      const recipeId = mapping.recipeId;
      const recipeDoc = recipesById[recipeId] ?? null;

      if (!recipeDoc) {
        recipeMissingCount++;
        unknowns.push({ line: ln, reason: 'recipe_missing' });
        continue;
      }

      const recipeYield: number | null = recipeDoc.yield ?? null;
      const items: any[] = Array.isArray(recipeDoc.items) ? recipeDoc.items : [];

      for (const item of items) {
        if (!item.productId) continue;
        const ingProduct = productById[item.productId] ?? null;
        const { stockQty, reason } = ingredientStockQty(
          ln.qtySold,
          item.qty,
          item.unit ?? 'each',
          recipeYield,
          ingProduct,
        );
        if (stockQty === null) unconvertibleCount++;
        recipeDeductions.push({
          posName:     ln.name,
          recipeId,
          recipeName:  recipeDoc.name ?? null,
          productId:   item.productId,
          productName: item.productName ?? ingProduct?.name ?? null,
          qtySold:     ln.qtySold,
          stockQty:    stockQty ?? null,
          unconvertibleReason: reason ?? null,
        });
      }
      continue;
    }

    // ── Product mapping or auto-match ─────────────────────────────────────────
    const result = matchSalesLine(ln, productIndex, confirmedMappings);
    if (result) {
      const product = productById[result.product.id] ?? result.product;
      const conv = stockUnitsPerSale(mapping ?? {}, product);
      matches.push({
        productId:        result.product.id,
        productName:      result.product.name ?? null,
        name:             ln.name,
        qtySold:          ln.qtySold,
        gross:            ln.gross ?? null,
        via:              result.via,
        stockQty:         ln.qtySold * conv.qty,
        conversionSource: conv.source,
        mappingType:      mapping?.mappingType ?? null,
      });
    } else {
      unknowns.push({ line: ln });
    }
  }

  const recipeMatchedNames = new Set(recipeDeductions.map(r => r.posName));

  return {
    matches,
    recipeDeductions,
    ignored,
    unknowns,
    counts: {
      total:         lines.length,
      totalQtySold:  lines.reduce((s, l) => s + (l.qtySold ?? 0), 0),
      matched:       matches.length,
      unknowns:      unknowns.length,
      recipeMatched: recipeMatchedNames.size,
      recipeMissing: recipeMissingCount,
      ignored:       ignored.length,
      unconvertible: unconvertibleCount,
    },
  };
}
