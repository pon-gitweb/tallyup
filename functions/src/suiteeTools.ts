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
}

export interface SupplierTrendEntry {
  supplierId: string | null;
  supplierName: string | null;
  changeCount: number;
  avgChangePercent: number;
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
    'Returns the top 5 suppliers ranked by highest average price-increase percentage ' +
    '(avgChangePercent), based on priceChangeFlags recorded for this venue. ' +
    'Each entry includes: supplierId, supplierName, changeCount (number of flagged events), ' +
    'avgChangePercent (mean across all events in the window), and direction (up/down/flat). ' +
    'Sorted by avgChangePercent descending — biggest average increase first. ' +
    'Returns hasData:false when no flags exist in the window. ' +
    'Use this whenever the user asks which suppliers have increased prices the most.',
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
    changes: number[];
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
      groups.set(groupKey, { supplierId: sid, supplierName: r.supplierName ?? null, changes: [] });
    }
    const g = groups.get(groupKey)!;
    g.changes.push(r.changePercent);
    // Prefer the ID-tagged name for display — it's more authoritative.
    if (r.supplierId && r.supplierName) g.supplierName = r.supplierName;
    if (sid && !g.supplierId) g.supplierId = sid;
  }

  // Compute stats per group.
  const entries: SupplierTrendEntry[] = [];
  for (const g of groups.values()) {
    const sum = g.changes.reduce((a, b) => a + b, 0);
    const avg = Math.round((sum / g.changes.length) * 100) / 100;
    entries.push({
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      changeCount: g.changes.length,
      avgChangePercent: avg,
      direction: avg > 0 ? 'up' : avg < 0 ? 'down' : 'flat',
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
    'Use this when the user asks which recipes have the worst or lowest margins.',
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
    'Returns hasData:false when no non-preferred purchases exist in the window.',
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
    'Returns hasData:false when no stocktake velocity data is available.',
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

// ── runToolLoop ───────────────────────────────────────────────────────────────

/** Callable passed in by the caller — wraps the actual Anthropic API fetch. */
export type ClaudeCallFn = (
  messages: Array<{ role: string; content: string | any[] }>,
) => Promise<{ content: any[] }>;

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
