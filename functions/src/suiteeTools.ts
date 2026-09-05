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
