/**
 * Tests for the Stage-0 Suitee tool-calling helpers (suiteeTools.ts).
 *
 * Two exported functions are covered:
 *
 *   resolveGpAnalysis(keyword, products, recipes) → GpAnalysisResult
 *     Pure resolver: matches a keyword against the venue's product and recipe lists,
 *     computes GP% using computeGpPercent (products) or computeRecipeGpPct (recipes),
 *     and returns honest missingFields rather than silently returning null.
 *
 *   runToolLoop(callFn, messages, resolveToolCall, maxRounds) → Promise<string>
 *     Capped multi-turn loop: real tool_use block detection, tool execution,
 *     hard cap of 3 rounds with a safe fallback if the cap is hit.
 *
 * Strategy: pure function tests for resolveGpAnalysis (A–C), mock-based tests for
 * runToolLoop loop mechanics (D). No Firestore, no network. Jest globals only.
 */

import {
  resolveGpAnalysis,
  runToolLoop,
  SuiteeProduct,
  SuiteeRecipe,
} from '../suiteeTools';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCTS: SuiteeProduct[] = [
  {
    // Complete pricing — used for hand-verified GP% assertion.
    // sellPriceExGst = 16 / 1.15 = 13.9130..., GP% = Math.round((13.9130 - 5) / 13.9130 * 100) = 64
    name: 'Hendricks Gin 700ml',
    costPrice: 5.00,
    sellPrice: 16.00,
    gstPercent: 15,
  },
  {
    // Missing costPrice only.
    name: 'Sauvignon Blanc Glass',
    costPrice: null,
    sellPrice: 12.00,
    gstPercent: 15,
  },
  {
    // Missing sellPrice and gstPercent.
    name: 'Mystery Vodka 700ml',
    costPrice: 30.00,
    sellPrice: null,
    gstPercent: null,
  },
];

const RECIPES: SuiteeRecipe[] = [
  {
    // Complete — hand-verified: round2(((20 - 3) / 20) * 100) = 85
    name: 'Classic Negroni',
    rrp: 20.00,
    cogs: 3.00,
  },
  {
    // Missing rrp.
    name: 'Espresso Martini',
    rrp: null,
    cogs: 2.00,
  },
];

// ── Suite A: resolveGpAnalysis — product resolution ──────────────────────────

describe('resolveGpAnalysis — product resolution', () => {

  it('A1: complete product → found:true, type:product, correct gpPercent (hand-verified 64)', () => {
    // sellPriceExGst = 16 / 1.15 = 13.913..., GP% = Math.round(8.913 / 13.913 * 100) = 64
    const result = resolveGpAnalysis('Hendricks Gin', PRODUCTS, RECIPES);
    expect(result.found).toBe(true);
    expect(result.type).toBe('product');
    expect(result.name).toBe('Hendricks Gin 700ml');
    expect(result.gpPercent).toBe(64);
    expect(result.sellPrice).toBe(16.00);
    expect(result.costPrice).toBe(5.00);
    expect(result.missingFields).toEqual([]);
  });

  it('A2: product missing costPrice → found:true, gpPercent:null, missingFields contains costPrice', () => {
    const result = resolveGpAnalysis('Sauvignon Blanc', PRODUCTS, RECIPES);
    expect(result.found).toBe(true);
    expect(result.type).toBe('product');
    expect(result.gpPercent).toBeNull();
    expect(result.missingFields).toContain('costPrice');
    // sellPrice was present — should not appear in missingFields
    expect(result.missingFields).not.toContain('sellPrice');
  });

  it('A3: product missing sellPrice and gstPercent → gpPercent:null, both in missingFields', () => {
    const result = resolveGpAnalysis('Mystery Vodka', PRODUCTS, RECIPES);
    expect(result.found).toBe(true);
    expect(result.type).toBe('product');
    expect(result.gpPercent).toBeNull();
    expect(result.missingFields).toContain('sellPrice');
    expect(result.missingFields).toContain('gstPercent');
  });

  it('A4: product is matched before recipe when both exist for the same keyword', () => {
    // Add a recipe with a similar name to confirm products take precedence.
    const recipesWithConflict: SuiteeRecipe[] = [
      { name: 'Hendricks Gin Cocktail', rrp: 18, cogs: 4 },
      ...RECIPES,
    ];
    const result = resolveGpAnalysis('Hendricks Gin', PRODUCTS, recipesWithConflict);
    expect(result.type).toBe('product');
    expect(result.name).toBe('Hendricks Gin 700ml');
  });
});

// ── Suite B: resolveGpAnalysis — recipe resolution ───────────────────────────

describe('resolveGpAnalysis — recipe resolution', () => {

  it('B1: complete recipe → found:true, type:recipe, correct gpPercent (hand-verified 85)', () => {
    // round2(((20 - 3) / 20) * 100) = round2(85) = 85
    const result = resolveGpAnalysis('Negroni', PRODUCTS, RECIPES);
    expect(result.found).toBe(true);
    expect(result.type).toBe('recipe');
    expect(result.name).toBe('Classic Negroni');
    expect(result.gpPercent).toBe(85);
    expect(result.rrp).toBe(20.00);
    expect(result.cogs).toBe(3.00);
    expect(result.missingFields).toEqual([]);
    // Product fields are null for a recipe result
    expect(result.sellPrice).toBeNull();
    expect(result.costPrice).toBeNull();
  });

  it('B2: recipe missing rrp → found:true, gpPercent:null, missingFields contains rrp', () => {
    const result = resolveGpAnalysis('Espresso Martini', PRODUCTS, RECIPES);
    expect(result.found).toBe(true);
    expect(result.type).toBe('recipe');
    expect(result.gpPercent).toBeNull();
    expect(result.missingFields).toContain('rrp');
    // cogs was present — should not appear in missingFields
    expect(result.missingFields).not.toContain('cogs');
  });
});

// ── Suite C: resolveGpAnalysis — no match / edge inputs ─────────────────────

describe('resolveGpAnalysis — no match and edge inputs', () => {

  it('C1: nonsense keyword → found:false, nothing crashes', () => {
    const result = resolveGpAnalysis('xyzzy_not_a_real_product_at_all', PRODUCTS, RECIPES);
    expect(result.found).toBe(false);
    expect(result.type).toBeNull();
    expect(result.gpPercent).toBeNull();
  });

  it('C2: empty keyword → found:false, nothing crashes', () => {
    const result = resolveGpAnalysis('', PRODUCTS, RECIPES);
    expect(result.found).toBe(false);
  });

  it('C3: whitespace-only keyword → found:false, nothing crashes', () => {
    const result = resolveGpAnalysis('   ', PRODUCTS, RECIPES);
    expect(result.found).toBe(false);
  });

  it('C4: empty product and recipe arrays → found:false, nothing crashes', () => {
    const result = resolveGpAnalysis('Hendricks Gin', [], []);
    expect(result.found).toBe(false);
  });
});

// ── Suite D: runToolLoop — loop mechanics and round cap ──────────────────────

describe('runToolLoop — loop mechanics', () => {

  it('D1: callFn returns text on first call → answer returned, callFn called once', async () => {
    const callFn = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'The GP on Hendricks is 64%.' }],
    });

    const result = await runToolLoop(
      callFn,
      [{ role: 'user', content: 'What is the GP on Hendricks Gin?' }],
      (_name, _input) => ({ found: false }),
    );

    expect(result).toBe('The GP on Hendricks is 64%.');
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it('D2: callFn returns tool_use then text → loop runs 2 rounds, answer from second call', async () => {
    const callFn = jest.fn()
      .mockResolvedValueOnce({
        // Round 1: Claude calls the tool.
        content: [{
          type: 'tool_use',
          id: 'tu_round1',
          name: 'get_gp_analysis',
          input: { keyword: 'Hendricks Gin' },
        }],
      })
      .mockResolvedValueOnce({
        // Round 2: Claude gives the final text answer.
        content: [{ type: 'text', text: 'Hendricks Gin has a 64% GP margin.' }],
      });

    const resolveToolCall = jest.fn().mockReturnValue({ found: true, gpPercent: 64 });

    const result = await runToolLoop(
      callFn,
      [{ role: 'user', content: 'GP on Hendricks?' }],
      resolveToolCall,
    );

    expect(result).toBe('Hendricks Gin has a 64% GP margin.');
    expect(callFn).toHaveBeenCalledTimes(2);
    expect(resolveToolCall).toHaveBeenCalledWith('get_gp_analysis', { keyword: 'Hendricks Gin' });
  });

  it('D3: callFn always returns tool_use → hard cap stops after maxRounds calls, fallback returned', async () => {
    // The round cap is the non-negotiable safety net — if Claude keeps calling tools
    // without ever returning a text response, the loop must stop and return the fallback.
    const callFn = jest.fn().mockResolvedValue({
      content: [{
        type: 'tool_use',
        id: 'tu_inf',
        name: 'get_gp_analysis',
        input: { keyword: 'gin' },
      }],
    });

    const result = await runToolLoop(
      callFn,
      [{ role: 'user', content: 'GP on gin?' }],
      (_name, _input) => ({ found: false }),
      3, // explicit maxRounds
    );

    // Exactly 3 Claude API calls before the cap fires.
    expect(callFn).toHaveBeenCalledTimes(3);
    // The fallback message — not a crash, not an empty string.
    expect(result).toMatch(/wasn't able to complete/);
  });

  it('D4: tool execution error → structured error in tool_result, loop continues', async () => {
    const callFn = jest.fn()
      .mockResolvedValueOnce({
        content: [{
          type: 'tool_use',
          id: 'tu_err',
          name: 'get_gp_analysis',
          input: { keyword: 'gin' },
        }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Sorry, could not retrieve that data.' }],
      });

    // Resolver throws — error must become a tool_result payload, not crash the request.
    const throwingResolver = jest.fn().mockImplementation(() => {
      throw new Error('simulated resolver failure');
    });

    const result = await runToolLoop(callFn, [{ role: 'user', content: 'GP?' }], throwingResolver);

    // Loop recovered and returned the second-round text response.
    expect(result).toBe('Sorry, could not retrieve that data.');
    expect(callFn).toHaveBeenCalledTimes(2);

    // The tool_result passed to the second Claude call should contain the error JSON.
    const secondCallMessages = callFn.mock.calls[1][0];
    const toolResultTurn = secondCallMessages.find(
      (m: any) => m.role === 'user' && Array.isArray(m.content),
    );
    expect(toolResultTurn).toBeDefined();
    const resultContent = toolResultTurn.content[0];
    expect(resultContent.type).toBe('tool_result');
    const parsed = JSON.parse(resultContent.content);
    expect(parsed.error).toMatch(/Tool execution error/);
  });
});
