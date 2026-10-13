/**
 * suiteeTools.ts
 *
 * Pure helpers for the /suitee tool-calling loop.
 * Extracted so they can be tested without importing api.ts (which initialises
 * Firebase and starts an Express server on import).
 *
 * Stage 0 — get_gp_analysis:
 *   resolveGpAnalysis, GP_ANALYSIS_TOOL, SuiteeProduct, SuiteeRecipe, GpAnalysisResult
 *
 * Stage 1 — get_supplier_price_trend:
 *   aggregateSupplierTrend, SUPPLIER_TREND_TOOL,
 *   PriceChangeRecord, SupplierTrendEntry, SupplierTrendResult
 *
 * runToolLoop handles both tools in a single capped loop (hard cap 3 rounds).
 * resolveToolCall may be sync or async — the loop awaits Promise.resolve() each time.
 */

import { tokenizeForMatching, overlapCoefficient, isReliableMatch } from './nameMatching';
import { computeGpPercent } from './priceTracking';
import { computeRecipeGpPct } from './priceCascade';
import { flagAnomalousChanges, SanityInput } from './priceChangeSanity';
import {
  buildVelocityRowsFromReports,
  buildStockMap,
  matchDocToMatchData,
  partitionReports,
  weekDayBreakdown,
  daySpan,
  type ActiveReport,
  type MatchData,
  type StockEntry,
} from './weeklyLedger';
import { isReportActive } from './isReportActive';

// ── Stage 0: get_gp_analysis interfaces ──────────────────────────────────────

export interface SuiteeProduct {
  name: string;
  costPrice: number | null;
  sellPrice: number | null;
  gstPercent: number | null;
}

export interface SuiteeRecipe {
  name: string;
  rrp: number | null;
  cogs: number | null;
}

export interface GpAnalysisResult {
  found: boolean;
  type: 'product' | 'recipe' | null;
  name: string | null;
  gpPercent: number | null;
  sellPrice: number | null;
  costPrice: number | null;
  rrp: number | null;
  cogs: number | null;
  missingFields: string[];
}

// ── Stage 1: get_supplier_price_trend interfaces ──────────────────────────────

/** One priceChangeFlags record as fetched by the caller and passed to aggregation. */
export interface PriceChangeRecord {
  supplierId: string | null;
  supplierName: string | null;
  changePercent: number;
  /** Product name from the flags doc — used as the label when flagging anomalous changes. */
  productName?: string | null;
}

export interface SupplierTrendEntry {
  supplierId: string | null;
  supplierName: string | null;
  changeCount: number;
  /** Clean average (anomalous events excluded) — the published figure; same as cleanAverage. */
  avgChangePercent: number;
  /** Raw average including all events. Equals avgChangePercent when nothing is flagged. */
  rawAverage: number;
  /** Average excluding events where |changePercent| > ANOMALOUS_CHANGE_THRESHOLD_PCT. */
  cleanAverage: number;
  /** Events excluded from cleanAverage (|value| > threshold). Each carries its product label. */
  flagged: SanityInput[];
  direction: 'up' | 'down' | 'flat';
}

export interface SupplierTrendResult {
  hasData: boolean;
  suppliers: SupplierTrendEntry[];
  windowDays: number;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

/**
 * Stage 0 tool — look up GP% for a named product or CraftIt recipe.
 */
export const GP_ANALYSIS_TOOL = {
  name: 'get_gp_analysis',
  description:
    'Look up the gross-profit percentage for a specific product or CraftIt recipe by name or ' +
    'keyword. Returns structured data including GP%, sell price, cost price, and any missing ' +
    'fields that prevented a calculation. Always relay exactly what this tool returns — never ' +
    'compute or estimate a GP% yourself from raw numbers.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The product or recipe name to look up, as the user mentioned it.',
      },
    },
    required: ['keyword'],
  },
} as const;

/**
 * Stage 1 tool — rank suppliers by average price increase over a look-back window.
 * Sorted by avgChangePercent descending (the supplier with the highest average
 * price increase is returned first). Top 5 only.
 */
export const SUPPLIER_TREND_TOOL = {
  name: 'get_supplier_price_trend',
  description:
    'Returns the top 5 suppliers ranked by highest clean average price-increase percentage ' +
    '(avgChangePercent — anomalous events excluded), based on priceChangeFlags recorded for this venue. ' +
    'Each entry includes: supplierId, supplierName, changeCount (number of flagged events), ' +
    'avgChangePercent (clean average excluding |change| > 75%; same as cleanAverage), ' +
    'rawAverage (mean including all events), cleanAverage, ' +
    'flagged (events with |change| > 75%, each with value and label identifying the product), ' +
    'and direction (up/down/flat based on cleanAverage). ' +
    'Sorted by avgChangePercent descending — biggest clean average increase first. ' +
    'Returns hasData:false when no flags exist in the window. ' +
    'When flagged is non-empty for a supplier, always report both rawAverage and cleanAverage and name the ' +
    'flagged item(s); recommend calling get_price_change_detail for any flagged product to investigate further. ' +
    'Use this whenever the user asks which suppliers have increased prices the most. ' +
    'Always relay exactly what this tool returns — never rank or average suppliers yourself from price history or invoice data in context.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'Look-back window in days. Defaults to 90 if omitted.',
      },
    },
    required: [],
  },
} as const;

// ── resolveGpAnalysis ─────────────────────────────────────────────────────────

/**
 * Resolves a keyword against the venue's product list and CraftIt recipe list, then
 * computes GP% using the appropriate formula.
 *
 * - Products checked first; recipes only when no product matches.
 * - Name matching reuses tokenizeForMatching + overlapCoefficient + isReliableMatch
 *   (same 0.85 threshold used throughout the codebase).
 * - Best-score wins when multiple candidates exceed the threshold.
 * - Returns honest missingFields rather than silently returning null.
 */
export function resolveGpAnalysis(
  keyword: string,
  products: SuiteeProduct[],
  recipes: SuiteeRecipe[],
): GpAnalysisResult {
  const notFound: GpAnalysisResult = {
    found: false, type: null, name: null, gpPercent: null,
    sellPrice: null, costPrice: null, rrp: null, cogs: null,
    missingFields: [],
  };

  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) return notFound;
  const kwClean = keyword.trim();
  const kwTokens = tokenizeForMatching(kwClean);

  // ── 1. Products (checked first) ──────────────────────────────────────────────
  let bestProduct: SuiteeProduct | null = null;
  let bestProductScore = 0;
  for (const p of products) {
    const score = overlapCoefficient(kwClean, p.name);
    const pTokens = tokenizeForMatching(p.name);
    if (isReliableMatch(kwTokens, pTokens, score) && score > bestProductScore) {
      bestProduct = p;
      bestProductScore = score;
    }
  }

  if (bestProduct) {
    const missing: string[] = [];
    if (bestProduct.sellPrice == null) missing.push('sellPrice');
    if (bestProduct.costPrice == null) missing.push('costPrice');
    if (bestProduct.gstPercent == null) missing.push('gstPercent');

    // computeGpPercent handles nulls internally — always safe to call.
    const gpPercent = computeGpPercent(bestProduct.sellPrice, bestProduct.costPrice, bestProduct.gstPercent);

    return {
      found: true,
      type: 'product',
      name: bestProduct.name,
      gpPercent,
      sellPrice: bestProduct.sellPrice,
      costPrice: bestProduct.costPrice,
      rrp: null,
      cogs: null,
      missingFields: missing,
    };
  }

  // ── 2. Recipes (fallback when no product matched) ────────────────────────────
  let bestRecipe: SuiteeRecipe | null = null;
  let bestRecipeScore = 0;
  for (const r of recipes) {
    const score = overlapCoefficient(kwClean, r.name);
    const rTokens = tokenizeForMatching(r.name);
    if (isReliableMatch(kwTokens, rTokens, score) && score > bestRecipeScore) {
      bestRecipe = r;
      bestRecipeScore = score;
    }
  }

  if (bestRecipe) {
    const missing: string[] = [];
    if (bestRecipe.rrp == null) missing.push('rrp');
    if (bestRecipe.cogs == null) missing.push('cogs');

    // computeRecipeGpPct(rrp, cogs): returns null when rrp is null or <= 0.
    const gpPercent = computeRecipeGpPct(bestRecipe.rrp, bestRecipe.cogs ?? 0);

    return {
      found: true,
      type: 'recipe',
      name: bestRecipe.name,
      gpPercent,
      sellPrice: null,
      costPrice: null,
      rrp: bestRecipe.rrp,
      cogs: bestRecipe.cogs,
      missingFields: missing,
    };
  }

  return notFound;
}

// ── aggregateSupplierTrend ────────────────────────────────────────────────────

/**
 * Groups priceChangeFlags records by supplierId (falling back to supplierName for older
 * records without one), computes average change % per supplier, and returns the top N
 * sorted by avgChangePercent descending (highest average increase first).
 *
 * Grouping discipline (non-negotiable):
 *   - Primary key: supplierId — prevents a rename from splitting one supplier's history.
 *   - Fallback: for records where supplierId is null, first build a name→id lookup from
 *     the ID-tagged records in the same batch, so name-only legacy records are merged into
 *     the correct supplier group rather than creating a phantom duplicate.
 *   - If no matching supplierId is found for a name-only record, it forms its own group
 *     keyed by normalised name — the same graceful-degradation pattern used elsewhere.
 *
 * @param records    Array of priceChangeFlags data fetched by the caller.
 * @param topN       Maximum entries to return (default 5).
 * @param windowDays Echoed back into the result so callers can report it.
 */
export function aggregateSupplierTrend(
  records: PriceChangeRecord[],
  topN = 5,
  windowDays = 90,
): SupplierTrendResult {
  if (records.length === 0) {
    return { hasData: false, suppliers: [], windowDays };
  }

  // Pass 1: build name → supplierId lookup from ID-tagged records.
  // Used to merge name-only (older) records into the correct supplier group.
  const nameToId = new Map<string, string>();
  for (const r of records) {
    if (r.supplierId && r.supplierName) {
      const key = r.supplierName.toLowerCase().trim();
      if (!nameToId.has(key)) nameToId.set(key, r.supplierId);
    }
  }

  // Pass 2: resolve each record's canonical group key.
  const groups = new Map<string, {
    supplierId: string | null;
    supplierName: string | null;
    labelledChanges: SanityInput[];
  }>();

  for (const r of records) {
    let groupKey: string;
    let sid: string | null;

    if (r.supplierId) {
      groupKey = `id:${r.supplierId}`;
      sid = r.supplierId;
    } else if (r.supplierName) {
      const nameLower = r.supplierName.toLowerCase().trim();
      const lookedUp = nameToId.get(nameLower);
      if (lookedUp) {
        // Name-only record whose supplier is known from ID-tagged siblings — merge it.
        groupKey = `id:${lookedUp}`;
        sid = lookedUp;
      } else {
        // Truly orphan name-only record — group by normalised name.
        groupKey = `name:${nameLower}`;
        sid = null;
      }
    } else {
      continue; // no supplierId, no supplierName — skip
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { supplierId: sid, supplierName: r.supplierName ?? null, labelledChanges: [] });
    }
    const g = groups.get(groupKey)!;
    g.labelledChanges.push({ value: r.changePercent, label: r.productName || `event ${g.labelledChanges.length + 1}` });
    // Prefer the ID-tagged name for display — it's more authoritative.
    if (r.supplierId && r.supplierName) g.supplierName = r.supplierName;
    if (sid && !g.supplierId) g.supplierId = sid;
  }

  // Compute stats per group.
  const entries: SupplierTrendEntry[] = [];
  for (const g of groups.values()) {
    const sanity = flagAnomalousChanges(g.labelledChanges);
    entries.push({
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      changeCount: g.labelledChanges.length,
      avgChangePercent: sanity.cleanAverage,
      rawAverage: sanity.rawAverage,
      cleanAverage: sanity.cleanAverage,
      flagged: sanity.flagged,
      direction: sanity.cleanAverage > 0 ? 'up' : sanity.cleanAverage < 0 ? 'down' : 'flat',
    });
  }

  // Sort by avgChangePercent descending (biggest average increase first).
  entries.sort((a, b) => b.avgChangePercent - a.avgChangePercent);

  return {
    hasData: true,
    suppliers: entries.slice(0, topN),
    windowDays,
  };
}

// ── Stage 2: get_worst_gp_recipes ────────────────────────────────────────────

export interface WorstGpRecipeEntry {
  recipeName: string;
  gpPercent: number;
  rrp: number;
  cogs: number;
}

export interface WorstGpRecipeResult {
  hasData: boolean;
  recipes: WorstGpRecipeEntry[];
  /** How many recipes were skipped because rrp or cogs was absent. */
  excludedCount: number;
}

/**
 * Stage 2 tool — rank CraftIt recipes by worst GP%, ascending (lowest first).
 */
export const WORST_GP_RECIPES_TOOL = {
  name: 'get_worst_gp_recipes',
  description:
    'Returns the worst-performing CraftIt recipes by gross-profit percentage, ' +
    'sorted ascending (lowest GP% first, so the worst recipe is at index 0). ' +
    'Only recipes with both rrp and cogs recorded are ranked — those missing ' +
    'either field are excluded and counted in excludedCount, not scored as 0%. ' +
    'Returns hasData:false when no recipes are rankable. ' +
    'Use this when the user asks which recipes have the worst or lowest margins. ' +
    'Always relay exactly what this tool returns — never compute or estimate recipe GP% yourself from raw rrp or cogs figures in context.',
  input_schema: {
    type: 'object',
    properties: {
      topN: {
        type: 'number',
        description: 'Maximum number of recipes to return. Defaults to 5 if omitted.',
      },
    },
    required: [],
  },
} as const;

/**
 * Ranks recipes by GP% ascending (worst first), excluding those without
 * calculable GP% entirely rather than treating them as 0%.
 *
 * A recipe with missing rrp or cogs isn't confirmed to have a bad margin —
 * it simply has no margin on record. Scoring it as 0% would misrepresent it.
 *
 * @param recipes  The venue's recipe list, already fetched by the caller.
 * @param topN     Maximum entries to return (default 5).
 */
export function aggregateWorstGpRecipes(
  recipes: SuiteeRecipe[],
  topN = 5,
): WorstGpRecipeResult {
  let excludedCount = 0;
  const scored: WorstGpRecipeEntry[] = [];

  for (const r of recipes) {
    if (r.rrp == null || r.cogs == null) {
      excludedCount++;
      continue;
    }
    // computeRecipeGpPct returns null when rrp <= 0 — exclude those too.
    const gp = computeRecipeGpPct(r.rrp, r.cogs);
    if (gp === null) {
      excludedCount++;
      continue;
    }
    scored.push({ recipeName: r.name, gpPercent: gp, rrp: r.rrp, cogs: r.cogs });
  }

  if (scored.length === 0) {
    return { hasData: false, recipes: [], excludedCount };
  }

  // Sort ascending — lowest GP% (worst margin) first.
  scored.sort((a, b) => a.gpPercent - b.gpPercent);

  return {
    hasData: true,
    recipes: scored.slice(0, topN),
    excludedCount,
  };
}

// ── Stage 3: get_supplier_compliance ─────────────────────────────────────────

/**
 * One invoiceHistory entry as fetched by the caller and passed to aggregation.
 * Includes a dateMs field so the aggregation can find the most-recent preferred
 * price without needing Firestore Timestamps in the pure function.
 */
export interface InvoiceHistoryRecord {
  productId: string;
  productName: string;
  unitCost: number;
  qty: number;
  wasPreferredSupplier: boolean | null;
  dateMs: number;
}

export interface SupplierComplianceEntry {
  productName: string;
  totalPurchases: number;
  nonPreferredPurchases: number;
  /** Dollar amount above preferred price; null when no preferred-price baseline exists in the window. */
  estimatedExtraCost: number | null;
}

export interface SupplierComplianceResult {
  hasData: boolean;
  products: SupplierComplianceEntry[];
  windowDays: number;
}

/**
 * Stage 3 tool — surface products where purchases were made from non-preferred
 * suppliers, ranked by estimated extra cost.
 */
export const SUPPLIER_COMPLIANCE_TOOL = {
  name: 'get_supplier_compliance',
  description:
    'Returns products where purchases were made from non-preferred suppliers in the ' +
    'look-back window, ranked by estimatedExtraCost descending (most costly drift first). ' +
    'For each product: totalPurchases (all invoice events in window), nonPreferredPurchases ' +
    '(from a non-preferred supplier), and estimatedExtraCost — the dollar difference vs the ' +
    'preferred supplier\'s most-recent price in the same window, null when no preferred-price ' +
    'baseline exists for comparison. Products with 100% preferred-supplier compliance excluded. ' +
    'Returns hasData:false when no non-preferred purchases exist in the window. ' +
    'Always relay exactly what this tool returns — never estimate compliance costs or non-preferred purchase rates yourself from invoice context.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'Look-back window in days. Defaults to 90 if omitted.',
      },
    },
    required: [],
  },
} as const;

/**
 * Groups invoiceHistory records by product, counts preferred vs non-preferred
 * purchases, and computes the dollar impact of non-preferred buying.
 *
 * Extra-cost calculation:
 *   - Find the most-recent preferred-supplier unitCost for the product (by dateMs).
 *   - For each non-preferred entry where unitCost > that benchmark:
 *       add (unitCost − benchmark) × qty to estimatedExtraCost.
 *   - If no preferred entry exists in the window: estimatedExtraCost = null
 *     (honest gap — not fabricated as 0 or as the full spend).
 *
 * Sorting: entries with a real dollar figure sort before null entries (descending).
 *
 * @param records    invoiceHistory entries fetched by the caller, already filtered
 *                   to this venue and the time window.
 * @param topN       Maximum entries to return (default 5).
 * @param windowDays Echoed back into the result.
 */
export function aggregateSupplierCompliance(
  records: InvoiceHistoryRecord[],
  topN = 5,
  windowDays = 90,
): SupplierComplianceResult {
  // Group records by productId.
  const byProduct = new Map<string, { productName: string; recs: InvoiceHistoryRecord[] }>();
  for (const r of records) {
    if (!r.productId) continue;
    if (!byProduct.has(r.productId)) {
      byProduct.set(r.productId, { productName: r.productName, recs: [] });
    }
    byProduct.get(r.productId)!.recs.push(r);
  }

  const entries: SupplierComplianceEntry[] = [];

  for (const { productName, recs } of byProduct.values()) {
    const nonPreferredRecs = recs.filter(r => r.wasPreferredSupplier === false);
    if (nonPreferredRecs.length === 0) continue; // 100% compliant — exclude

    // Most-recent preferred-supplier entry (sorted by dateMs ascending, last = newest).
    const preferredRecs = recs
      .filter(r => r.wasPreferredSupplier === true)
      .sort((a, b) => a.dateMs - b.dateMs);
    const preferredBenchmark = preferredRecs.length > 0
      ? preferredRecs[preferredRecs.length - 1].unitCost
      : null;

    let estimatedExtraCost: number | null = null;
    if (preferredBenchmark !== null) {
      let extra = 0;
      for (const r of nonPreferredRecs) {
        const diff = r.unitCost - preferredBenchmark;
        if (diff > 0) extra += diff * r.qty;
      }
      estimatedExtraCost = Math.round(extra * 100) / 100;
    }

    entries.push({
      productName,
      totalPurchases: recs.length,
      nonPreferredPurchases: nonPreferredRecs.length,
      estimatedExtraCost,
    });
  }

  if (entries.length === 0) {
    return { hasData: false, products: [], windowDays };
  }

  // Sort by estimatedExtraCost descending; null entries trail all real figures.
  entries.sort((a, b) => {
    if (a.estimatedExtraCost !== null && b.estimatedExtraCost !== null) {
      return b.estimatedExtraCost - a.estimatedExtraCost;
    }
    if (a.estimatedExtraCost !== null) return -1;
    if (b.estimatedExtraCost !== null) return 1;
    return 0;
  });

  return {
    hasData: true,
    products: entries.slice(0, topN),
    windowDays,
  };
}

// ── Stage 6: get_gp_trend ─────────────────────────────────────────────────────

/** One row from the venues/{venueId}/gpAlerts collection, already mapped to ms. */
export interface GpAlertRecord {
  recipeName: string;
  recipeId: string;
  ingredientName: string;
  oldGpPct: number | null;
  newGpPct: number | null;
  /** Firestore createdAt converted to milliseconds (for sorting and date formatting). */
  createdAtMs: number;
}

/** One discrete GP-impacting event in the trend output. */
export interface GpTrendEvent {
  /** ISO date string (YYYY-MM-DD, UTC) derived from createdAt. */
  date: string;
  oldGpPct: number | null;
  newGpPct: number | null;
  ingredientName: string;
}

export interface GpTrendResult {
  found: boolean;
  recipeName: string | null;
  events: GpTrendEvent[];
  hasData: boolean;
}

/**
 * Stage 6 tool — surface the discrete ingredient-price events that moved a
 * recipe's GP%, within the requested time window.
 *
 * Tool description explicitly states the gap: alert history only captures
 * changes that crossed the venue's material-change threshold — gradual drift
 * is invisible.
 */
export const GP_TREND_TOOL = {
  name: 'get_gp_trend',
  description:
    'Returns the sequence of ingredient-price events that moved a named recipe\'s ' +
    'GP% within the requested window (default 90 days). Each event shows the ' +
    'triggering ingredient, the before/after GP%, and the date. ' +
    'IMPORTANT LIMITATION: this shows when material changes happened, not a smooth ' +
    'trend line. Alerts are only written when a price change clears the venue\'s ' +
    'materiality threshold — a recipe that drifted gradually below that threshold ' +
    'over many small moves may show zero alerts even though its GP did decline, and ' +
    'this tool has no way to see that. Always note this limitation when presenting ' +
    'results, especially a "no alerts" answer. ' +
    'Always relay exactly what this tool returns — never estimate a recipe\'s GP trend yourself from ingredient price changes visible in context.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'Recipe name or keyword (fuzzy-matched against gpAlert history)',
      },
      days: {
        type: 'number',
        description: 'Lookback window in days (default 90)',
      },
    },
    required: ['keyword'],
  },
} as const;

/**
 * Matches `keyword` against the recipe names present in the supplied alert records
 * and returns their events in chronological order.
 *
 * Uses the same tokenize+overlap matching as get_gp_analysis (same imports, same
 * call pattern) — no second matcher.
 *
 * hasData: false is returned both when no recipe matches the keyword AND when the
 * keyword matches but there are zero events — the distinction is signalled by
 * `found` so Claude can phrase the answer appropriately ("I don't recognise that
 * recipe" vs "this recipe had no material GP events in the window").
 *
 * @param keyword  Raw user-supplied keyword; trimmed internally.
 * @param records  gpAlert rows for the time window (already fetched by the resolver).
 */
export function aggregateGpTrend(
  keyword: string,
  records: GpAlertRecord[],
): GpTrendResult {
  const noMatch: GpTrendResult = { found: false, recipeName: null, events: [], hasData: false };
  if (!keyword || !keyword.trim() || records.length === 0) return noMatch;

  const kwClean = keyword.trim();
  const kwTokens = tokenizeForMatching(kwClean);

  // Collect distinct recipe names from the alert records and find the best match.
  const seen = new Set<string>();
  const recipeNames: string[] = [];
  for (const r of records) {
    if (!seen.has(r.recipeName)) { seen.add(r.recipeName); recipeNames.push(r.recipeName); }
  }

  let bestName: string | null = null;
  let bestScore = 0;
  for (const name of recipeNames) {
    const score = overlapCoefficient(kwClean, name);
    const nTokens = tokenizeForMatching(name);
    if (isReliableMatch(kwTokens, nTokens, score) && score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  if (!bestName) return noMatch;

  // Filter to the matched recipe's records, sorted chronologically.
  const matched = records
    .filter(r => r.recipeName === bestName)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  if (matched.length === 0) {
    // found: true but zero events — recipe appeared in alert history but nothing
    // survived the filter (shouldn't occur in practice since we matched from records).
    return { found: true, recipeName: bestName, events: [], hasData: false };
  }

  const events: GpTrendEvent[] = matched.map(r => ({
    date: new Date(r.createdAtMs).toISOString().split('T')[0],
    oldGpPct: r.oldGpPct,
    newGpPct: r.newGpPct,
    ingredientName: r.ingredientName,
  }));

  return { found: true, recipeName: bestName, events, hasData: true };
}

// ── Helpers for batch ratio consistency ──────────────────────────────────────

/** Median of a sorted-ascending numeric array. */
function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Converts a stock depletion velocity (stock units / week) to an implied
 * serves-per-week figure, using the recipe ingredient's spec qty and unit.
 *
 * Mirrors the unit-conversion logic already proven in api.ts ~lines 4423–4435
 * (the pour-variance section). Same logic, same cases — referenced not
 * reimplemented.
 */
function impliedServes(
  avgVelocity: number,
  qty: number,
  unit: string,
  packSizeMl: number | null | undefined,
  packSizeG: number | null | undefined,
): number | null {
  if (qty <= 0) return null;
  const u = unit.toLowerCase().trim();
  if (u === 'ml' || u === 'l') {
    if (!packSizeMl || packSizeMl <= 0) return null;
    const specMl = u === 'l' ? qty * 1000 : qty;
    return specMl > 0 ? (avgVelocity * packSizeMl) / specMl : null;
  }
  if (u === 'g' || u === 'kg') {
    if (!packSizeG || packSizeG <= 0) return null;
    const specG = u === 'kg' ? qty * 1000 : qty;
    return specG > 0 ? (avgVelocity * packSizeG) / specG : null;
  }
  if (['each', 'ea', 'unit', 'count', ''].includes(u)) {
    return avgVelocity / qty;
  }
  return null; // unknown unit — skip rather than guess
}

// ── Stage 4: get_batch_ratio_consistency ─────────────────────────────────────

export interface BatchRecipeItem {
  productId: string | null;
  productName: string;
  qty: number;
  unit: string;
  packSizeMl?: number | null;
  packSizeG?: number | null;
}

export interface BatchRecipe {
  id: string;
  name: string;
  items: BatchRecipeItem[];
}

export interface BatchIngredientResult {
  productName: string;
  /** % deviation from the recipe's median implied-serves-per-week; negative = consuming less than expected. */
  variancePercent: number;
}

export interface BatchRatioEntry {
  recipeName: string;
  ingredients: BatchIngredientResult[];
  /** true when every ingredient is within 20% of the recipe's median implied rate. */
  ratioConsistent: boolean;
}

export interface BatchRatioResult {
  hasData: boolean;
  recipes: BatchRatioEntry[];
}

/**
 * Stage 4 tool — flag recipes where ingredients are depleting out of proportion
 * with their recipe spec ratios, which can indicate wastage, substitution, or
 * a recipe not being followed — but cannot distinguish between these causes.
 */
export const BATCH_RATIO_TOOL = {
  name: 'get_batch_ratio_consistency',
  description:
    'For each CraftIt recipe with 2+ stock-tracked ingredients, compares each ' +
    "ingredient's actual depletion rate against the recipe's proportional spec. " +
    'Each ingredient gets a variancePercent showing how far its implied consumption ' +
    'rate deviates from the recipe\'s median. Recipes where any ingredient exceeds ' +
    '20% deviation are flagged ratioConsistent: false. ' +
    'IMPORTANT LIMITATION: this identifies divergence worth investigating, not a ' +
    'diagnosis. It cannot distinguish "recipe not followed" from "ingredient used ' +
    'elsewhere" or "one item wasted independently of the batch." Always present ' +
    'findings as something worth looking into, never as a confirmed conclusion. ' +
    'Returns hasData:false when no stocktake velocity data is available. ' +
    'Always relay exactly what this tool returns — never estimate batch consistency yourself from velocity or stocktake numbers in context.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

/**
 * Computes batch ratio consistency across a set of recipes.
 *
 * For each recipe with ≥2 velocity-trackable ingredients:
 *   1. Compute avg velocity per ingredient (non-zero velocities only).
 *   2. Convert to "implied serves / week" using the same unit-conversion logic
 *      as the pour-variance section of the Suitee route (~lines 4423–4435).
 *   3. Find the median implied-serves/week across scoreable ingredients.
 *   4. Express each ingredient's deviation from that median as a %.
 *   5. ratioConsistent = no ingredient exceeds ±20%.
 *
 * Coverage gaps reduce output, not correctness:
 *   - Ingredient missing productId → skipped
 *   - ml/g ingredient missing packSize → skipped (can't convert velocity to recipe units)
 *   - Recipe with < 2 scoreable ingredients → excluded
 *   - All velocities zero or empty → hasData: false
 *
 * Sorted by each recipe's max |variancePercent| descending (most divergent first).
 *
 * @param recipes               Recipe documents mapped to BatchRecipe shape.
 * @param velocitiesByProductId productId → velocities[] map from the route handler's
 *                              productCycles closure; non-zero velocities are averaged.
 * @param topN                  Maximum entries to return (default 5).
 * @param threshold             Deviation % that triggers ratioConsistent: false (default 20).
 */
export function aggregateBatchRatioConsistency(
  recipes: BatchRecipe[],
  velocitiesByProductId: Map<string, number[]>,
  topN = 5,
  threshold = 20,
): BatchRatioResult {
  const entries: Array<BatchRatioEntry & { maxAbsVar: number }> = [];

  for (const recipe of recipes) {
    const scoreable: Array<{ productName: string; implied: number }> = [];

    for (const item of recipe.items) {
      if (!item.productId || item.qty <= 0) continue;

      const vels = velocitiesByProductId.get(item.productId);
      if (!vels) continue;
      const nonZero = vels.filter(v => v !== 0); // matches existing pour-variance pattern
      if (nonZero.length === 0) continue;

      const avgVel = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      const implied = impliedServes(avgVel, item.qty, item.unit, item.packSizeMl, item.packSizeG);
      if (implied == null || implied <= 0) continue;

      scoreable.push({ productName: item.productName, implied });
    }

    if (scoreable.length < 2) continue; // not enough data points to detect ratio drift

    const sortedImplied = [...scoreable.map(s => s.implied)].sort((a, b) => a - b);
    const med = medianSorted(sortedImplied);
    if (med <= 0) continue; // guard against division by zero

    const ingredients: BatchIngredientResult[] = scoreable.map(s => ({
      productName: s.productName,
      variancePercent: Math.round(((s.implied - med) / med * 100) * 100) / 100,
    }));

    const maxAbsVar = Math.max(...ingredients.map(i => Math.abs(i.variancePercent)));

    entries.push({
      recipeName: recipe.name,
      ingredients,
      ratioConsistent: maxAbsVar <= threshold, // "exceeds threshold" = strictly >
      maxAbsVar,
    });
  }

  if (entries.length === 0) return { hasData: false, recipes: [] };

  entries.sort((a, b) => b.maxAbsVar - a.maxAbsVar);

  return {
    hasData: true,
    recipes: entries.slice(0, topN).map(({ recipeName, ingredients, ratioConsistent }) => ({
      recipeName, ingredients, ratioConsistent,
    })),
  };
}

// ── Stage 7: get_menu_engineering ────────────────────────────────────────────

/**
 * A recipe passed to aggregateMenuEngineering.
 * Extends SuiteeRecipe with `id` so we can join against salesReportRecipeMatches.
 */
export interface MenuEngineeringRecipe {
  id:   string;
  name: string;
  rrp:  number | null;
  cogs: number | null;
}

/** Pre-aggregated sales data for one recipe, provided by the resolver. */
export interface RecipeSalesData {
  /** Count of distinct qualifying (non-superseded, at least one overlapping cycle) reports. */
  reportCount:  number;
  /** Total qty sold across all qualifying reports. */
  qtySoldTotal: number;
}

export type MenuEngineeringQuadrant = 'star' | 'plowhorse' | 'puzzle' | 'dog';

export interface MenuEngineeringEntry {
  recipeId:    string;
  recipeName:  string;
  gpPercent:   number;
  qtySoldTotal: number;
  /** Number of qualifying reports that contributed to this recipe's volume. */
  reportCount: number;
  quadrant:    MenuEngineeringQuadrant;
}

export interface MenuEngineeringResult {
  hasData:     boolean;
  stars:       MenuEngineeringEntry[];
  plowhorses:  MenuEngineeringEntry[];
  puzzles:     MenuEngineeringEntry[];
  dogs:        MenuEngineeringEntry[];
  /**
   * Total recipes excluded. Broken down by reason:
   *   excludedNoGp      — rrp or cogs missing / rrp ≤ 0
   *   excludedLowData   — fewer than MINIMUM_QUALIFYING_REPORTS qualifying reports
   */
  excludedCount:    number;
  excludedNoGp:     number;
  excludedLowData:  number;
  /** Venue-relative threshold used to split high vs low margin. */
  medianGpPercent: number | null;
  /** Venue-relative threshold used to split high vs low volume. */
  medianQtySold:   number | null;
}

/**
 * Stage 7 tool — classify CraftIt recipes into the four standard menu
 * engineering quadrants.
 *
 * Tool description explicitly states the data-availability limitation, matching
 * the pattern established by GP_TREND_TOOL for its own gap.
 */
export const MENU_ENGINEERING_TOOL = {
  name: 'get_menu_engineering',
  description:
    'Classifies CraftIt recipes into the four standard menu engineering quadrants: ' +
    'Stars (high margin + high volume), Plowhorses (low margin + high volume), ' +
    'Puzzles (high margin + low volume), and Dogs (low margin + low volume). ' +
    'Margin is GP% from recorded rrp/cogs — same source as get_worst_gp_recipes. ' +
    'Volume is total qty sold, aggregated from tagged sales reports that overlap ' +
    'completed stocktake cycles. ' +
    'IMPORTANT LIMITATION: requires at least 2 non-superseded sales reports per ' +
    'recipe that are each linked to a completed stocktake cycle; recipes without ' +
    'sufficient tagged history are excluded and counted, not guessed at or scored ' +
    'as zero. Thresholds are relative to this venue\'s own eligible recipe pool — ' +
    'not absolute — so the quadrant boundary moves with the venue\'s own typical ' +
    'margins and volumes. Returns hasData:false when too few recipes qualify. ' +
    'Always relay exactly what this tool returns — never classify recipes into quadrants yourself from margin or sales-volume data in context.',
  input_schema: {
    type: 'object',
    properties: {
      topN: {
        type: 'number',
        description: 'Maximum recipes to return per quadrant. Defaults to 5 if omitted.',
      },
    },
    required: [],
  },
} as const;

/**
 * Minimum number of qualifying reports required before a recipe is eligible for
 * quadrant placement.
 *
 * Reasoning: 1 report could be an unusual period (holiday, trial item, one-off
 * event) — classifying from a single data point would misplace many recipes.
 * 2 reports across distinct completed-cycle periods gives the minimum evidence of
 * a repeating pattern. We don't require 3+ because that would exclude most venues
 * that recently started uploading sales data, making the tool nearly useless on
 * rollout. Each qualifying report must additionally be linked to at least one
 * completed stocktake cycle (enforced in the resolver, not here), so "2 reports"
 * implies "2 periods of anchored, real operational data" — not just 2 test uploads.
 */
const MINIMUM_QUALIFYING_REPORTS = 2;

/**
 * Classifies recipes into menu engineering quadrants.
 *
 * Pure function: all Firestore fetching and filtering is done by the resolver,
 * which passes in pre-aggregated salesByRecipeId keyed by recipe Firestore doc ID.
 * Only reports that are non-superseded AND linked to at least one completed
 * stocktake cycle should be included in salesByRecipeId — the resolver enforces
 * this; this function trusts the map it receives.
 *
 * @param recipes         Recipe list including id, name, rrp, cogs.
 * @param salesByRecipeId Keyed by recipeId; values are pre-filtered totals.
 * @param topN            Max entries per quadrant (default 5).
 */
export function aggregateMenuEngineering(
  recipes:         MenuEngineeringRecipe[],
  salesByRecipeId: Map<string, RecipeSalesData>,
  topN = 5,
): MenuEngineeringResult {
  let excludedNoGp    = 0;
  let excludedLowData = 0;

  type Candidate = {
    id:           string;
    name:         string;
    gpPercent:    number;
    qtySoldTotal: number;
    reportCount:  number;
  };

  const candidates: Candidate[] = [];

  for (const r of recipes) {
    // Must have calculable GP%.
    if (r.rrp == null || r.cogs == null) { excludedNoGp++; continue; }
    const gp = computeRecipeGpPct(r.rrp, r.cogs);
    if (gp === null) { excludedNoGp++; continue; }

    // Must meet the confidence bar.
    const sales = salesByRecipeId.get(r.id);
    if (!sales || sales.reportCount < MINIMUM_QUALIFYING_REPORTS) {
      excludedLowData++;
      continue;
    }

    candidates.push({
      id:           r.id,
      name:         r.name,
      gpPercent:    gp,
      qtySoldTotal: sales.qtySoldTotal,
      reportCount:  sales.reportCount,
    });
  }

  if (candidates.length === 0) {
    return {
      hasData:         false,
      stars:           [],
      plowhorses:      [],
      puzzles:         [],
      dogs:            [],
      excludedCount:   excludedNoGp + excludedLowData,
      excludedNoGp,
      excludedLowData,
      medianGpPercent: null,
      medianQtySold:   null,
    };
  }

  // Venue-relative medians — thresholds move with this venue's own distribution.
  const sortedGp  = [...candidates.map(c => c.gpPercent)].sort((a, b) => a - b);
  const sortedVol = [...candidates.map(c => c.qtySoldTotal)].sort((a, b) => a - b);
  const medGp  = medianSorted(sortedGp);
  const medVol = medianSorted(sortedVol);

  // Classify.
  const classify = (gpPct: number, vol: number): MenuEngineeringQuadrant => {
    const highMargin = gpPct >= medGp;
    const highVolume = vol  >= medVol;
    if (highMargin && highVolume)  return 'star';
    if (!highMargin && highVolume) return 'plowhorse';
    if (highMargin && !highVolume) return 'puzzle';
    return 'dog';
  };

  const byQuadrant: Record<MenuEngineeringQuadrant, MenuEngineeringEntry[]> = {
    star: [], plowhorse: [], puzzle: [], dog: [],
  };

  for (const c of candidates) {
    const q = classify(c.gpPercent, c.qtySoldTotal);
    byQuadrant[q].push({
      recipeId:    c.id,
      recipeName:  c.name,
      gpPercent:   c.gpPercent,
      qtySoldTotal: c.qtySoldTotal,
      reportCount:  c.reportCount,
      quadrant:    q,
    });
  }

  // Sort each quadrant by volume descending (highest sellers first), then limit.
  const sortLimit = (arr: MenuEngineeringEntry[]) =>
    arr.sort((a, b) => b.qtySoldTotal - a.qtySoldTotal).slice(0, topN);

  return {
    hasData:         true,
    stars:           sortLimit(byQuadrant.star),
    plowhorses:      sortLimit(byQuadrant.plowhorse),
    puzzles:         sortLimit(byQuadrant.puzzle),
    dogs:            sortLimit(byQuadrant.dog),
    excludedCount:   excludedNoGp + excludedLowData,
    excludedNoGp,
    excludedLowData,
    medianGpPercent: medGp,
    medianQtySold:   medVol,
  };
}

// ── Stage 8: get_price_change_detail ─────────────────────────────────────────

/** One raw priceHistory event, pre-fetched and pre-filtered by the resolver. */
export interface PriceDetailRawRecord {
  productId: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  direction: string;
  supplierName: string;
  dateMs: number;
}

export interface PriceChangeDetailEvent {
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  direction: string;
  supplierName: string;
  date: string; // YYYY-MM-DD
}

export interface PriceChangeDetailProduct {
  productId: string;
  productName: string;
  /** Individual events in chronological order (oldest first). */
  events: PriceChangeDetailEvent[];
  /**
   * Single correct change across the window: earliest oldPrice → latest newPrice,
   * computed as a direct (latest - earliest) / earliest calculation.
   * Never a sum of individual step percentages.
   * null when fewer than 2 events exist for this product in the window.
   */
  windowChange: {
    oldPrice: number;
    newPrice: number;
    changePercent: number;
    direction: string;
  } | null;
}

export interface PriceChangeDetailResult {
  hasData: boolean;
  windowDays: number;
  products: PriceChangeDetailProduct[];
}

/**
 * Stage 8 tool — retrieve real, per-event price-change history for a specific
 * product or supplier.
 */
export const PRICE_CHANGE_DETAIL_TOOL = {
  name: 'get_price_change_detail',
  description:
    'Returns real, per-product price-change events — before price, after price, percent ' +
    'change, date, direction — for the matched product(s) and/or supplier, within the ' +
    'requested window (defaults to 90 days). At least one of productKeyword or ' +
    'supplierKeyword is required. ' +
    'When a single product had more than one price-change event in the window, the tool ' +
    'returns both (a) one single, correct change from the earliest to the latest known ' +
    'price in that window (windowChange — a direct endpoint-to-endpoint calculation, never ' +
    'a sum of intermediate percent steps), and (b) the individual events in between, clearly ' +
    'labeled as intermediate steps. ' +
    'Returns hasData:false with no fabricated substitute when nothing matches. ' +
    'Always relay exactly what this tool returns — never compute, estimate, or summarise ' +
    'price history yourself from memory of other calls or from aggregate context numbers.',
  input_schema: {
    type: 'object',
    properties: {
      productKeyword: {
        type: 'string',
        description: 'Product name or keyword (fuzzy-matched against the product catalogue).',
      },
      supplierKeyword: {
        type: 'string',
        description: 'Supplier name or keyword (fuzzy-matched against supplierName on each history entry).',
      },
      days: {
        type: 'number',
        description: 'Look-back window in days. Defaults to 90 if omitted.',
      },
    },
    required: [],
  },
} as const;

/**
 * Pure function: groups pre-fetched, pre-filtered priceHistory records by product,
 * sorts events chronologically, and computes the endpoint-to-endpoint windowChange.
 *
 * The resolver in api.ts handles Firestore fetching, days-window filtering, and
 * keyword matching; this function receives only the matching records.
 *
 * windowChange is computed as (latest.newPrice − earliest.oldPrice) / earliest.oldPrice —
 * never as a sum or average of the individual step changePercents.
 */
export function buildPriceChangeDetail(
  records: PriceDetailRawRecord[],
  windowDays: number,
): PriceChangeDetailResult {
  if (records.length === 0) {
    return { hasData: false, windowDays, products: [] };
  }

  const byProduct = new Map<string, { productName: string; recs: PriceDetailRawRecord[] }>();
  for (const r of records) {
    if (!byProduct.has(r.productId)) {
      byProduct.set(r.productId, { productName: r.productName, recs: [] });
    }
    byProduct.get(r.productId)!.recs.push(r);
  }

  const products: PriceChangeDetailProduct[] = [];

  for (const [productId, { productName, recs }] of byProduct.entries()) {
    recs.sort((a, b) => a.dateMs - b.dateMs); // chronological: oldest first

    const events: PriceChangeDetailEvent[] = recs.map(r => ({
      oldPrice:      r.oldPrice,
      newPrice:      r.newPrice,
      changePercent: r.changePercent,
      direction:     r.direction,
      supplierName:  r.supplierName,
      date:          new Date(r.dateMs).toISOString().slice(0, 10),
    }));

    let windowChange: PriceChangeDetailProduct['windowChange'] = null;
    if (recs.length >= 1) {
      const oldest = recs[0];
      const newest = recs[recs.length - 1];
      const oldPrice = oldest.oldPrice;
      const newPrice = newest.newPrice;
      const changePercent = oldPrice > 0
        ? Math.round(((newPrice - oldPrice) / oldPrice) * 10000) / 100
        : 0;
      windowChange = {
        oldPrice,
        newPrice,
        changePercent,
        direction: newPrice > oldPrice ? 'increase' : newPrice < oldPrice ? 'decrease' : 'unchanged',
      };
    }

    products.push({ productId, productName, events, windowChange });
  }

  return { hasData: true, windowDays, products };
}

// ── runToolLoop ───────────────────────────────────────────────────────────────

/** Callable passed in by the caller — wraps the actual Anthropic API fetch. */
export type ClaudeCallFn = (
  messages: Array<{ role: string; content: string | any[] }>,
) => Promise<{ content: any[]; stop_reason?: string }>;

const LOOP_FALLBACK =
  "I wasn't able to complete that analysis within the allowed steps. Please try rephrasing your question.";

/**
 * Runs a capped multi-turn Anthropic tool-calling loop.
 *
 * - On each round: calls Claude, checks content blocks for tool_use.
 * - If no tool_use block: final text answer — exits immediately.
 * - If tool_use AND rounds remain: executes each tool call (awaiting the resolver,
 *   which may be async), appends assistant + tool_result turns, continues.
 * - If the round cap is hit without a final text answer: returns LOOP_FALLBACK.
 * - Tool execution errors (sync throws or rejected promises) become structured
 *   tool_result payloads so Claude can react rather than crashing the request.
 *
 * @param callFn          Wraps the Anthropic API call. Receives the full messages array.
 * @param messages        Mutable — assistant and tool_result turns are appended each round.
 * @param resolveToolCall (name, input) → result or Promise<result>. Unknown names → error.
 * @param maxRounds       Hard cap on Claude API calls. Default 3 (non-negotiable safety net).
 */
export async function runToolLoop(
  callFn: ClaudeCallFn,
  messages: Array<{ role: string; content: string | any[] }>,
  resolveToolCall: (name: string, input: any) => any,
  maxRounds = 3,
): Promise<string> {
  let answer = "I'm having trouble accessing your data right now. Please try again.";
  let roundsLeft = maxRounds;

  while (roundsLeft > 0) {
    roundsLeft--;

    const data = await callFn(messages);
    const contentBlocks: any[] = data?.content ?? [];

    // Genuine type check — not the naive content[0].text assumption.
    const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');
    const textBlocks    = contentBlocks.filter((b: any) => b.type === 'text');

    if (toolUseBlocks.length === 0) {
      // Final answer — Claude chose to respond with text rather than call a tool.
      answer = textBlocks[0]?.text ?? answer;
      if (data.stop_reason === 'max_tokens') {
        answer += '\n\n(Answer shortened — ask me to continue.)';
      }
      break;
    }

    if (roundsLeft === 0) {
      // Hard cap hit: we ran maxRounds calls and still have tool_use — stop safely.
      answer = LOOP_FALLBACK;
      break;
    }

    // Append the assistant's tool-calling turn so the next call has full history.
    messages.push({ role: 'assistant', content: contentBlocks });

    // Execute each tool call sequentially — resolver may be async (e.g. Firestore query).
    // Errors (sync throws or rejected Promises) are caught and returned as structured
    // tool_result payloads so Claude can acknowledge rather than the request crashing.
    const toolResults: any[] = [];
    for (const block of toolUseBlocks) {
      let result: any;
      try {
        result = await Promise.resolve(resolveToolCall(block.name, block.input ?? {}));
      } catch (err: any) {
        result = { error: `Tool execution error: ${err?.message ?? 'unknown'}` };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return answer;
}

// ── Sales performance tool ────────────────────────────────────────────────────

export interface SalesPerfInput {
  question_type: 'summary' | 'product' | 'top_sellers' | 'slowing' | 'stagnant';
  product_name?: string;
  weeks?: number;
}

export const SALES_PERFORMANCE_TOOL = {
  name: 'get_sales_performance',
  description: [
    'Returns sales velocity and revenue data from imported sales reports.',
    'Use for any question about sales volume, revenue, best sellers, slow movers, stagnant lines,',
    'sales trends, or a specific product\'s recent performance.',
    'question_type: summary=window totals + change%, product=single product lookup (use product_name),',
    'top_sellers=top 15 by units, slowing=15 lines with >25% rate drop, stagnant=lines with zero last-4-week sales.',
    'weeks defaults to 4 (max 26). product_name is required for question_type=product.',
  ].join(' '),
  input_schema: {
    type: 'object' as const,
    properties: {
      question_type: {
        type: 'string',
        enum: ['summary', 'product', 'top_sellers', 'slowing', 'stagnant'],
      },
      product_name: {
        type: 'string',
        description: 'Required for question_type=product. Case-insensitive substring match.',
      },
      weeks: {
        type: 'number',
        description: 'Window size in weeks (default 4, max 26).',
      },
    },
    required: ['question_type'] as const,
  },
} as const;

/**
 * Pure aggregation for sales performance. Filters allReports to active only internally.
 * Exported for tests — pass pre-loaded ActiveReport[], MatchData, StockEntry records.
 */
export function buildSalesPerformanceResult(
  allReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  stockMap: Record<string, StockEntry>,
  input: SalesPerfInput,
  todayNZ: string,
): Record<string, any> {
  const reports = allReports.filter(r => isReportActive({ status: r.status }));
  const weeksParam = Math.min(26, Math.max(1, typeof input.weeks === 'number' ? Math.round(input.weeks) : 4));

  const { rows: velocityRows, windowInfo } = buildVelocityRowsFromReports(
    reports, matchesByReport, stockMap, todayNZ,
  );

  const anchorMon = windowInfo.anchorMonday;

  function addDays(s: string, n: number): string {
    return new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10);
  }

  // Calendar weeks in the requested window (oldest first)
  const winMondays: string[] = [];
  for (let i = weeksParam - 1; i >= 0; i--) winMondays.push(addDays(anchorMon, -(i * 7)));

  // Active dated matched reports for data computation
  const matchedReports = reports.filter(r => r.startStr && r.endStr && matchesByReport[r.id] != null);

  // Match coverage across all active reports
  const totalLines  = reports.reduce((s, r) => s + r.lineCount, 0);
  const totalQty    = reports.reduce((s, r) => s + r.totalQtySold, 0);
  const matchedLines = reports.reduce((s, r) => s + (matchesByReport[r.id]?.matched ?? 0), 0);
  const matchedQty   = reports.reduce((s, r) => s + (matchesByReport[r.id]?.matchedQty ?? 0), 0);
  const linesPct = totalLines > 0 ? Math.round(matchedLines / totalLines * 100) : 0;
  const unitsPct = totalQty   > 0 ? Math.round(matchedQty   / totalQty   * 100) : 0;
  const reportsNotMatched = reports.filter(r => matchesByReport[r.id] == null).length;

  // All active dated reports (for allSales computation)
  const allDatedReports = reports.filter(r => r.startStr && r.endStr);

  // Weekly table — allSales from ALL active reports; matchedProducts from matched only
  const weeklyTable = winMondays.map(wkMon => {
    const wkSun = addDays(wkMon, 6);

    // allSales: all active dated reports
    let allUnits = 0, revIncl = 0, revExcl = 0, anyInclOnly = false;
    for (const r of allDatedReports) {
      if (r.startStr! > wkSun || r.endStr! < wkMon) continue;
      const totalDays = r.days ?? 1;
      const os = r.startStr! > wkMon ? r.startStr! : wkMon;
      const oe = r.endStr!   < wkSun  ? r.endStr!  : wkSun;
      const frac = daySpan(os, oe) / totalDays;
      const canShowExGst = r.meta?.lineTotalsBasis === 'line_total' &&
        r.meta?.gstBasis !== 'assumed_incl' && r.meta?.gstBasis !== 'unknown';
      if (!canShowExGst) anyInclOnly = true;
      for (const l of r.rawLines) {
        allUnits += (l.qtySold ?? 0) * frac;
        revIncl  += (l.grossIncl ?? l.gross ?? 0) * frac;
        revExcl  += (l.netExcl ?? l.net ?? 0) * frac;
      }
    }

    // matchedProducts: matched reports only
    let matchedUnits = 0;
    for (const r of matchedReports) {
      if (r.startStr! > wkSun || r.endStr! < wkMon) continue;
      const md = matchesByReport[r.id]!;
      const totalDays = r.days ?? 1;
      const os = r.startStr! > wkMon ? r.startStr! : wkMon;
      const oe = r.endStr!   < wkSun  ? r.endStr!  : wkSun;
      const frac = daySpan(os, oe) / totalDays;
      for (const m of md.matches) matchedUnits += (m.qtySold ?? 0) * frac;
    }

    return {
      weekStart: wkMon,
      allSales: {
        units:          Math.round(allUnits * 10) / 10,
        revenueInclGst: Math.round(revIncl  * 100) / 100,
        revenueExGst:   anyInclOnly ? null : Math.round(revExcl * 100) / 100,
        ...(anyInclOnly ? { inclOnly: true } : {}),
      },
      matchedProducts: {
        units: Math.round(matchedUnits * 10) / 10,
      },
    };
  });

  // Missing weeks (no matched report overlaps the week at all)
  const missingWeeks: string[] = [];
  let weeksCovered = 0;
  for (const wkMon of winMondays) {
    const wkSun = addDays(wkMon, 6);
    if (matchedReports.some(r => r.startStr! <= wkSun && r.endStr! >= wkMon)) weeksCovered++;
    else missingWeeks.push(wkMon);
  }

  const result: Record<string, any> = {
    weeksCovered,
    missingWeeks,
    last4CoveredDays: windowInfo.last4CoveredDays,
    prev4CoveredDays: windowInfo.prev4CoveredDays,
    newestReportEnd:  windowInfo.newestReportEnd,
    matchCoverage:    { linesPct, unitsPct },
    revenueBasis:     'ex GST',
    reportsNotMatched,
    weeklyTable,
  };

  // ── question_type: summary ──────────────────────────────────────────────────
  if (input.question_type === 'summary') {
    const last4Mondays = [-21, -14, -7, 0].map(d => addDays(anchorMon, d));
    const prev4Mondays = [-49, -42, -35, -28].map(d => addDays(anchorMon, d));
    const last4Set = new Set(last4Mondays);
    const prev4Set = new Set(prev4Mondays);

    // allSales: from ALL active dated reports
    let l4AllUnits = 0, p4AllUnits = 0;
    let l4RevIncl = 0, l4RevExcl = 0, l4InclOnly = false;
    let p4RevIncl = 0, p4RevExcl = 0, p4InclOnly = false;
    for (const r of allDatedReports) {
      const wdMap = weekDayBreakdown(r.startStr!, r.endStr!);
      const totalDays = r.days ?? 1;
      const isInclOnly = r.meta?.lineTotalsBasis !== 'line_total' ||
        r.meta?.gstBasis === 'assumed_incl' || r.meta?.gstBasis === 'unknown';
      let lf = 0, pf = 0;
      for (const [wk, d] of Object.entries(wdMap)) {
        if (last4Set.has(wk)) lf += d / totalDays;
        else if (prev4Set.has(wk)) pf += d / totalDays;
      }
      if (lf > 0) {
        if (isInclOnly) l4InclOnly = true;
        for (const l of r.rawLines) {
          l4AllUnits += (l.qtySold ?? 0) * lf;
          l4RevIncl  += (l.grossIncl ?? l.gross ?? 0) * lf;
          l4RevExcl  += (l.netExcl ?? l.net ?? 0) * lf;
        }
      }
      if (pf > 0) {
        if (isInclOnly) p4InclOnly = true;
        for (const l of r.rawLines) {
          p4AllUnits += (l.qtySold ?? 0) * pf;
          p4RevIncl  += (l.grossIncl ?? l.gross ?? 0) * pf;
          p4RevExcl  += (l.netExcl ?? l.net ?? 0) * pf;
        }
      }
    }

    // matchedProducts: from velocity rows
    let l4MatchedUnits = 0, p4MatchedUnits = 0;
    for (const row of velocityRows) { l4MatchedUnits += row.last4Units; p4MatchedUnits += row.prev4Units; }

    const last4RevExGst  = l4InclOnly ? null : Math.round(l4RevExcl * 100) / 100;
    const prev4RevExGst  = p4InclOnly ? null : Math.round(p4RevExcl * 100) / 100;
    const l4cov = windowInfo.last4CoveredDays, p4cov = windowInfo.prev4CoveredDays;
    const allSalesUnitChangePct = (l4cov >= 14 && p4cov >= 14 && p4AllUnits > 0)
      ? Math.round(((l4AllUnits / l4cov) / (p4AllUnits / p4cov) - 1) * 100) : null;
    const revChangePct = (last4RevExGst !== null && prev4RevExGst !== null && prev4RevExGst > 0)
      ? Math.round((last4RevExGst / prev4RevExGst - 1) * 100) : null;
    result.summary = {
      allSales: {
        last4Units:      Math.round(l4AllUnits  * 10) / 10,
        prev4Units:      Math.round(p4AllUnits  * 10) / 10,
        unitChangePct:   allSalesUnitChangePct,
        last4RevExGst,   prev4RevExGst,
        last4RevInclGst: Math.round(l4RevIncl   * 100) / 100,
        prev4RevInclGst: Math.round(p4RevIncl   * 100) / 100,
        revChangePct,
      },
      matchedProducts: {
        last4Units: Math.round(l4MatchedUnits * 10) / 10,
        prev4Units: Math.round(p4MatchedUnits * 10) / 10,
      },
      ...(l4InclOnly || p4InclOnly ? { revenueNote: 'incl-GST only (POS-sourced data)' } : {}),
    };
  }

  // ── question_type: product ──────────────────────────────────────────────────
  if (input.question_type === 'product') {
    const q = ((input.product_name ?? '') + '').toLowerCase().trim();
    if (!q) {
      result.product = { error: 'product_name is required for question_type=product' };
    } else {
      const hits = velocityRows.filter(r => r.name.toLowerCase().includes(q));
      if (hits.length === 0)      result.product = { found: false, query: q };
      else if (hits.length === 1) result.product = { found: true, ...hits[0] };
      else result.product = { found: false, ambiguous: true, query: q, candidates: hits.slice(0, 5).map(r => r.name) };
    }
  }

  // ── question_type: top_sellers / slowing / stagnant ─────────────────────────
  if (input.question_type === 'top_sellers') {
    result.top_sellers = [...velocityRows].sort((a, b) => b.last4Units - a.last4Units).slice(0, 15);
  }
  if (input.question_type === 'slowing') {
    result.slowing  = velocityRows.filter(r => r.status === 'Slowing').slice(0, 15);
  }
  if (input.question_type === 'stagnant') {
    result.stagnant = velocityRows.filter(r => r.status === 'Stagnant').slice(0, 15);
  }

  // 6 000-char cap — trim rows, mark truncated
  let json = JSON.stringify(result);
  if (json.length > 6000) {
    result.truncated = true;
    if (result.weeklyTable.length > 4) result.weeklyTable = result.weeklyTable.slice(-4);
    for (const k of ['top_sellers', 'slowing', 'stagnant']) {
      if (Array.isArray(result[k]) && (result[k] as any[]).length > 8) result[k] = (result[k] as any[]).slice(0, 8);
    }
    json = JSON.stringify(result);
    if (json.length > 6000) {
      result.weeklyTable = result.weeklyTable.slice(-2);
      for (const k of ['top_sellers', 'slowing', 'stagnant']) {
        if (Array.isArray(result[k])) result[k] = (result[k] as any[]).slice(0, 4);
      }
    }
  }

  return result;
}

export interface SalesData {
  reports: ActiveReport[];
  matchesByReport: Record<string, MatchData | null>;
  stockMap: Record<string, StockEntry>;
}

/** Loads all sales data from Firestore. Call once per request and reuse. */
export async function loadSalesData(db: any, venueId: string): Promise<SalesData> {
  const salesSnap = await db.collection(`venues/${venueId}/salesReports`).get().catch(() => null);
  const allDocs: Array<{ id: string; data(): Record<string, any> }> = salesSnap?.docs ?? [];

  const { reports } = partitionReports(allDocs);

  // Load match docs: try direct lookup first, fallback to query-by-reportId
  const matchesByReport: Record<string, MatchData | null> = {};
  await Promise.all(reports.map(async r => {
    try {
      const direct = await db.doc(`venues/${venueId}/salesReportMatches/${r.id}`).get();
      if (direct.exists) {
        matchesByReport[r.id] = matchDocToMatchData(direct.data() as Record<string, any>);
      } else {
        const qs = await db.collection(`venues/${venueId}/salesReportMatches`)
          .where('reportId', '==', r.id).limit(1).get();
        if (!qs.empty) {
          matchesByReport[r.id] = matchDocToMatchData(qs.docs[0].data() as Record<string, any>);
        } else {
          matchesByReport[r.id] = null;
        }
      }
    } catch { matchesByReport[r.id] = null; }
  }));

  // Load stock from latest dept snapshots (non-fatal) — use snapshots, not cycles
  let stockMap: Record<string, StockEntry> = {};
  try {
    const deptsSnap = await db.collection(`venues/${venueId}/departments`).get().catch(() => null);
    if (deptsSnap && !deptsSnap.empty) {
      const rawSnapshots = await Promise.all(
        (deptsSnap.docs as any[]).map(async (dDoc: any) => {
          try {
            const cs = await db.collection(`venues/${venueId}/departments/${dDoc.id}/snapshots`)
              .orderBy('cycleNumber', 'desc').limit(1).get();
            if (cs.empty) return null;
            const d = cs.docs[0].data() as any;
            return { cycleNumber: d.cycleNumber ?? 0, items: d.items ?? [] };
          } catch { return null; }
        }),
      );
      stockMap = buildStockMap(rawSnapshots.filter(Boolean) as Array<{ cycleNumber: number; items: any[] }>);
    }
  } catch { /* stock optional */ }

  return { reports, matchesByReport, stockMap };
}

/**
 * Async resolver: loads sales data and returns buildSalesPerformanceResult.
 * Called from the tool loop in api.ts (resolveTool).
 */
export async function resolveSalesPerformance(
  db: any,
  venueId: string,
  input: SalesPerfInput,
  todayNZ: string,
): Promise<Record<string, any>> {
  const d = await loadSalesData(db, venueId);
  return buildSalesPerformanceResult(d.reports, d.matchesByReport, d.stockMap, input, todayNZ);
}
