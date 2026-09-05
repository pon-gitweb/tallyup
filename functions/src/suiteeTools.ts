/**
 * suiteeTools.ts
 *
 * Pure helpers for the /suitee tool-calling loop (Stage 0: get_gp_analysis).
 *
 * Extracted into their own module so they can be tested without importing api.ts,
 * which initialises Firebase and starts an Express server on import.
 *
 * Exports:
 *   resolveGpAnalysis  — keyword → GpAnalysisResult (products checked before recipes)
 *   runToolLoop        — capped multi-turn Anthropic tool-calling loop (hard cap 3 rounds)
 *   GP_ANALYSIS_TOOL   — tool definition to include in Claude API calls
 *   SuiteeProduct, SuiteeRecipe, GpAnalysisResult — interfaces
 */

import { tokenizeForMatching, overlapCoefficient, isReliableMatch } from './nameMatching';
import { computeGpPercent } from './priceTracking';
import { computeRecipeGpPct } from './priceCascade';

// ── Interfaces ────────────────────────────────────────────────────────────────

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

// ── Tool definition ───────────────────────────────────────────────────────────

/**
 * The single tool for Stage 0 — prove the agentic round-trip.
 * Include this in every Claude API request inside the suitee loop.
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

// ── resolveGpAnalysis ─────────────────────────────────────────────────────────

/**
 * Resolves a keyword against the venue's product list and CraftIt recipe list, then
 * computes GP% using the appropriate formula.
 *
 * - Products are checked first; recipes only when no product matches.
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
 * - If tool_use AND rounds remain: executes each tool call, appends assistant + tool_result
 *   turns to messages, continues.
 * - If the round cap is hit without a final text answer: returns LOOP_FALLBACK.
 * - Tool execution errors become structured tool_result payloads so Claude can react
 *   rather than crashing the request.
 *
 * @param callFn         Wraps the Anthropic API call. Receives the full messages array.
 * @param messages       Mutable — assistant and tool_result turns are appended each round.
 * @param resolveToolCall  (name, input) → result. Unknown tool names → error object.
 * @param maxRounds      Hard cap on Claude API calls. Default 3 (non-negotiable safety net).
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

    // Execute each tool call; errors are returned as structured results, never thrown.
    const toolResults: any[] = toolUseBlocks.map((block: any) => {
      let result: any;
      try {
        result = resolveToolCall(block.name, block.input ?? {});
      } catch (err: any) {
        result = { error: `Tool execution error: ${err?.message ?? 'unknown'}` };
      }
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      };
    });

    messages.push({ role: 'user', content: toolResults });
  }

  return answer;
}
