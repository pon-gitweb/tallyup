/**
 * Pure aggregation of sales data from salesReportMatches docs.
 * No Firebase imports.
 */

import { resolveId } from './resolve';

export type SalesFlag = 'sales_unit_unknown' | 'dollar_line';

export interface MatchEntry {
  productId?: string | null;
  stockQty?: number | null;
  conversionSource?: string | null;
  qtySold?: number | null;
  gross?: number | null;
}

export interface RecipeDeductionEntry {
  productId?: string | null;
  stockQty?: number | null;
}

export interface SalesMatchDoc {
  matches?: MatchEntry[];
  recipeDeductions?: RecipeDeductionEntry[];
}

export interface AggregatedSalesResult {
  /** Summed stock units sold per resolved productId (valid conversions only). */
  soldByProductId: Record<string, number>;
  /** Per-productId flags for lines excluded from the sold sum. */
  flagsByProductId: Record<string, SalesFlag[]>;
  /** Total POS revenue excluded across all excluded match lines. */
  excludedRevenue: number;
  /** Total count of excluded match lines (not recipe deductions). */
  excludedLines: number;
}

/**
 * Aggregate sold quantities from attached-report match docs.
 *
 * Inclusion rules for matches[]:
 *   - conversionSource must be 'servingMl', 'conversionRatio', or 'each'
 * Exclusion with flag:
 *   - conversionSource 'default' or 'unconvertible' → 'sales_unit_unknown'
 *   - qtySold > 0 and gross/qtySold ∈ [0.995, 1.005] → 'dollar_line'
 * Silently dropped (not flagged on any product):
 *   - lines without a productId
 *
 * recipeDeductions[] are included when stockQty is a finite number.
 *
 * productIds are resolved through mergedInto (cycle-safe, max 10 hops).
 */
export function aggregateSales(
  matchDocs: SalesMatchDoc[],
  mergedInto: Record<string, string>,
): AggregatedSalesResult {
  const soldByProductId: Record<string, number> = {};
  const flagsByProductId: Record<string, SalesFlag[]> = {};
  let excludedRevenue = 0;
  let excludedLines = 0;

  function addFlag(pid: string, flag: SalesFlag) {
    if (!flagsByProductId[pid]) flagsByProductId[pid] = [];
    if (!flagsByProductId[pid].includes(flag)) flagsByProductId[pid].push(flag);
  }

  for (const doc of matchDocs) {
    for (const m of doc.matches ?? []) {
      if (!m.productId) {
        excludedLines++;
        excludedRevenue += m.gross ?? 0;
        continue;
      }

      const pid = resolveId(m.productId, mergedInto);

      // Dollar-line check: each item sold for ~$1
      if ((m.qtySold ?? 0) > 0 && m.gross != null) {
        const ratio = m.gross / m.qtySold!;
        if (ratio >= 0.995 && ratio <= 1.005) {
          addFlag(pid, 'dollar_line');
          excludedLines++;
          excludedRevenue += m.gross;
          continue;
        }
      }

      // Conversion-source check
      const src = m.conversionSource;
      if (src === 'default' || src === 'unconvertible') {
        addFlag(pid, 'sales_unit_unknown');
        excludedLines++;
        excludedRevenue += m.gross ?? 0;
        continue;
      }

      // Valid: include stockQty
      if (m.stockQty != null && isFinite(m.stockQty)) {
        soldByProductId[pid] = (soldByProductId[pid] ?? 0) + m.stockQty;
      }
    }

    for (const rd of doc.recipeDeductions ?? []) {
      if (!rd.productId) continue;
      if (rd.stockQty == null || !isFinite(rd.stockQty)) continue;
      const pid = resolveId(rd.productId, mergedInto);
      soldByProductId[pid] = (soldByProductId[pid] ?? 0) + rd.stockQty;
    }
  }

  return { soldByProductId, flagsByProductId, excludedRevenue, excludedLines };
}
