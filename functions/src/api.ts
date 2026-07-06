import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import express = require("express");
import cors = require("cors");
import Stripe from "stripe";
import { trackPriceChanges } from "./priceTracking";
import { filterInvoiceLines } from "./invoiceFilter";
import { IZZY_FEATURES, COUNTING_GUIDANCE, SUITEE_COUNTING_NOTE, FESTIVAL_IZZY_FEATURES } from "./izzyContext";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20mb", verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; } }));

// ── Verify Firebase ID token from Authorization header ──────────────────────
async function verifyToken(req: express.Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function verifyVenueMembership(uid: string, venueId: string): Promise<void> {
  const memberDoc = await admin
    .firestore()
    .doc(`venues/${venueId}/members/${uid}`)
    .get();
  if (!memberDoc.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You are not a member of this venue.'
    );
  }
}

// ── Inline name-matching helpers (used for supplier/product dedup) ────────────

function normNameForMatch(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function tokenJaccardMatch(a: string, b: string): number {
  const ta = new Set(normNameForMatch(a).split(" ").filter(Boolean));
  const tb = new Set(normNameForMatch(b).split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / (ta.size + tb.size - intersection);
}

// ── AI Usage Meter ────────────────────────────────────────────────────────────

type AiCallType =
  | 'invoice_ocr' | 'product_photo' | 'shelf_scan' | 'stocktake_photo'
  | 'sales_report' | 'izzy' | 'suitee' | 'ai_insights'
  | 'suggest_orders' | 'variance_explain' | 'budget_suggest' | 'photo_count'
  | 'prediction_refinement' | 'recipe_generation';

interface MeterState {
  aiUsed: number;
  aiRemaining: number;
  aiLimit: number;
  resetAt: string;
  plan: 'beta' | 'core' | 'core_plus';
  usageWarning?: { feature: string; used: number; limit: number; percentUsed: number; message: string } | null;
}

const PLAN_LIMITS: Record<string, Record<string, number>> = {
  beta: {
    total: 300, invoice_ocr: 50, product_photo: 75, shelf_scan: 15,
    stocktake_photo: 40, sales_report: 10, izzy: 150, suitee: 50,
    ai_insights: 12, suggest_orders: 20, variance_explain: 12,
    prediction_refinement: 10, recipe_generation: 50,
  },
  core: {
    total: 200, invoice_ocr: 30, product_photo: 30, shelf_scan: 10,
    stocktake_photo: 20, sales_report: 5, izzy: 100, suitee: 30,
    ai_insights: 8, suggest_orders: 15, variance_explain: 8,
    prediction_refinement: 5, recipe_generation: 10,
  },
  core_plus: {
    total: 500, invoice_ocr: 80, product_photo: 100, shelf_scan: 30,
    stocktake_photo: 60, sales_report: 15, izzy: 300, suitee: 100,
    ai_insights: 20, suggest_orders: 40, variance_explain: 20,
    prediction_refinement: 20, recipe_generation: 30,
  },
};

const FEATURE_LABELS: Record<string, string> = {
  invoice_ocr: 'invoice scanning', product_photo: 'product photos',
  shelf_scan: 'shelf scanning', stocktake_photo: 'stocktake import',
  sales_report: 'sales report import', izzy: 'Izzy questions',
  suitee: 'Suitee queries', ai_insights: 'AI insights',
  suggest_orders: 'order suggestions', variance_explain: 'variance explanations',
  prediction_refinement: 'AI prediction refinement',
  recipe_generation: 'recipe generation',
};

function buildLimitMessage(feature: string, used: number, limit: number, resetAt: string): string {
  const resetDate = new Date(resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const msgs: Record<string, string> = {
    invoice_ocr: `You've scanned ${used} invoices this month — great work getting set up! Your scanning allowance resets on ${resetDate}. You can still add suppliers and products manually in the meantime.`,
    product_photo: `You've photographed ${used} products this month. Your photo allowance resets on ${resetDate}. You can still add products by searching or entering details manually.`,
    shelf_scan: `You've used your shelf scanning allowance for this month. Resets on ${resetDate}. Count products manually or use barcode scan.`,
    stocktake_photo: `You've imported ${used} stocktake pages this month. Resets on ${resetDate}. You can still run manual stocktakes.`,
    suitee: `Suitee has answered ${used} questions this month. Your allowance resets on ${resetDate}.`,
    izzy: `Izzy has helped with ${used} questions this month. Check our help docs at office@hosti.co.nz for common questions.`,
    ai_insights: `AI insights have run ${used} times this month. Resets on ${resetDate}.`,
    suggest_orders: `AI order suggestions have been used ${used} times this month. Resets on ${resetDate}.`,
    variance_explain: `Variance explanations have been used ${used} times this month. Resets on ${resetDate}.`,
  };
  const base = msgs[feature] || `You've reached your ${FEATURE_LABELS[feature] || feature} limit for this month. Resets on ${resetDate}.`;
  return base + '\n\nNeed more? Contact us at office@hosti.co.nz';
}

async function resolveVenuePlan(db: admin.firestore.Firestore, venueId: string): Promise<{ plan: string; effectivePlan: string }> {
  let plan = 'beta';
  let venueCreatedAt: number | null = null;
  try {
    const snap = await db.doc(`venues/${venueId}`).get();
    const d = snap.data();
    plan = d?.billingPlan || 'beta';
    venueCreatedAt = d?.createdAt?.toMillis?.() ?? null;
  } catch {}
  // Grace period: new 'core' venues get beta limits for 14 days
  let effectivePlan = plan;
  if (plan === 'core' && venueCreatedAt) {
    if (Date.now() - venueCreatedAt < 14 * 24 * 60 * 60 * 1000) effectivePlan = 'beta';
  }
  return { plan, effectivePlan };
}

async function trackAiCall(venueId: string, callType: AiCallType): Promise<MeterState> {
  const db = admin.firestore();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { plan, effectivePlan } = await resolveVenuePlan(db, venueId);
  const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.beta;
  const totalLimit = limits.total ?? 300;
  const featureLimit = limits[callType] ?? totalLimit;
  const usageRef = db.doc(`venues/${venueId}/aiUsage/${monthKey}`);

  let aiUsed = 0;
  let featureUsedAfter = 0;
  let usageWarning: MeterState['usageWarning'] = null;
  try {
    const snap = await usageRef.get();
    const data = snap.data() || {};
    aiUsed = (data.totalCalls || 0) + 1;
    featureUsedAfter = (data.breakdown?.[callType] || 0) + 1;

    await usageRef.set({
      totalCalls: aiUsed,
      lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
      resetAt,
      plan: effectivePlan,
      breakdown: { ...data.breakdown, [callType]: featureUsedAfter },
    }, { merge: true });

    // FIX 5: 80% warning
    const pct = Math.round((featureUsedAfter / featureLimit) * 100);
    if (pct >= 80 && pct < 100) {
      const label = FEATURE_LABELS[callType] || callType;
      const remaining = featureLimit - featureUsedAfter;
      usageWarning = {
        feature: callType,
        used: featureUsedAfter,
        limit: featureLimit,
        percentUsed: pct,
        message: `You've used ${pct}% of your monthly ${label} allowance (${featureUsedAfter} of ${featureLimit}). ${remaining} remaining this month.`,
      };
    }
  } catch (e) {
    console.log('[meter] tracking error', e);
    aiUsed = 1;
  }

  return {
    aiUsed,
    aiRemaining: Math.max(0, totalLimit - aiUsed),
    aiLimit: totalLimit,
    resetAt,
    plan: plan as MeterState['plan'],
    usageWarning,
  };
}

async function checkAiLimit(venueId: string, callType: AiCallType): Promise<{ allowed: boolean; meter: MeterState; limitError?: any }> {
  const db = admin.firestore();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { plan, effectivePlan } = await resolveVenuePlan(db, venueId);
  const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.beta;
  const totalLimit = limits.total ?? 300;
  const featureLimit = limits[callType] ?? totalLimit;

  let aiUsed = 0;
  let featureUsed = 0;
  try {
    const snap = await db.doc(`venues/${venueId}/aiUsage/${monthKey}`).get();
    const d = snap.data() || {};
    aiUsed = d.totalCalls || 0;
    featureUsed = d.breakdown?.[callType] || 0;
  } catch {}

  const baseMeter: MeterState = {
    aiUsed, aiRemaining: Math.max(0, totalLimit - aiUsed), aiLimit: totalLimit, resetAt, plan: plan as any,
  };

  if (aiUsed >= totalLimit) {
    const resetDate = new Date(resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' });
    return {
      allowed: false, meter: { ...baseMeter, aiRemaining: 0 },
      limitError: {
        error: 'limit_reached', feature: 'total', used: aiUsed, limit: totalLimit, plan,
        resetsAt: resetAt, upgradeAvailable: plan !== 'core_plus',
        message: `You've used all ${totalLimit} AI calls for this month. Resets on ${resetDate}.\n\nNeed more? Contact us at office@hosti.co.nz`,
      },
    };
  }

  if (featureUsed >= featureLimit) {
    return {
      allowed: false, meter: baseMeter,
      limitError: {
        error: 'limit_reached', feature: callType, used: featureUsed, limit: featureLimit, plan,
        resetsAt: resetAt, upgradeAvailable: plan !== 'core_plus',
        message: buildLimitMessage(callType, featureUsed, featureLimit, resetAt),
      },
    };
  }

  return { allowed: true, meter: baseMeter };
}

// ── POST /upload-file ────────────────────────────────────────────────────────
// Body: { destPath: string, dataUrl: string, cacheControl?: string }
// Returns: { ok: true, fullPath: string, downloadURL: string }
app.post("/upload-file", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const { venueId, destPath, dataUrl, cacheControl } = req.body || {};

    if (!venueId || typeof venueId !== "string") {
      res.status(400).json({ ok: false, error: "Missing venueId" });
      return;
    }
    await verifyVenueMembership(uid, venueId);

    if (!destPath || typeof destPath !== "string") {
      res.status(400).json({ ok: false, error: "Missing destPath" });
      return;
    }
    const allowedPrefixes = [
      `venues/${venueId}/`,
      `uploads/${venueId}/`,
      `festival-contracts/${venueId}/`,
      `festival-riders/${venueId}/`,
    ];
    const isAllowed = allowedPrefixes.some(prefix => destPath.startsWith(prefix));
    if (!isAllowed) {
      res.status(403).json({ error: "Storage path not permitted for this venue." });
      return;
    }

    if (!dataUrl || typeof dataUrl !== "string") {
      res.status(400).json({ ok: false, error: "Missing dataUrl" });
      return;
    }

    // Parse data URL — format: data:{contentType};base64,{data}
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) {
      res.status(400).json({ ok: false, error: "Invalid dataUrl format" });
      return;
    }
    const contentType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(destPath);

    await file.save(buffer, {
      metadata: {
        contentType,
        cacheControl: cacheControl || "private, max-age=0",
      },
    });

    // Get a signed download URL (valid 7 days)
    const [downloadURL] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    console.log("[api/upload-file] OK", { uid, destPath, contentType, bytes: buffer.length });
    res.json({ ok: true, fullPath: destPath, downloadURL });

  } catch (e: any) {
    console.error("[api/upload-file] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// ── Anthropic helper ────────────────────────────────────────────
async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error("Claude API error: " + err);
  }
  const data = await resp.json() as any;
  return data?.content?.[0]?.text || "";
}

// ── POST /variance-explain ───────────────────────────────────────
app.post("/variance-explain", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const ctx = req.body || {};
    const venueIdForLimit: string = ctx.venueId || ctx.aiContext?.venueId || "";
    if (venueIdForLimit) {
      await verifyVenueMembership(uid, venueIdForLimit);
      const lc = await checkAiLimit(venueIdForLimit, 'variance_explain');
      if (!lc.allowed) { res.status(429).json(lc.limitError); return; }
    }
    const productName = ctx.itemName || ctx.name || ctx.productId || "Product";
    const onHand = Number(ctx.counted ?? ctx.onHand ?? 0);
    const expected = Number(ctx.expected ?? ctx.par ?? 0);
    const variance = onHand - expected;
    const unit = ctx.unit || "units";
    const salesQty = ctx.salesQty ?? ctx.recentSoldQty ?? null;
    const invoiceQty = ctx.invoiceQty ?? ctx.recentReceivedQty ?? null;
    const shrinkUnits = ctx.shrinkUnits ?? 0;
    const costPerUnit = ctx.costPerUnit ?? ctx.realCostPerUnit ?? null;
    const attributionRecipe = ctx.attributionRecipe ?? null;
    const attributionPct = ctx.attributionPct ?? null;
    const systemPrompt = [
      "You are an AI assistant for Hosti, a hospitality inventory management app for NZ bars, restaurants and cafes.",
      "Explain stock variances in plain English a bar manager or chef would understand. Be concise and practical.",
      "If data is limited say so. Respond ONLY with valid JSON:",
      '{ "summary": "1-2 sentence explanation", "factors": ["factor 1"], "confidence": 0.0-1.0, "missing": ["helpful data"] }'
    ].join("\n");
    const varStr = (variance >= 0 ? "+" : "") + variance + " " + unit;
    const costStr = costPerUnit != null ? "$" + Number(costPerUnit).toFixed(2) : null;
    // Extract AI context if provided
    const aiCtx = req.body?.aiContext || null;
    const topVariance = Array.isArray(aiCtx?.topVarianceItems) ? aiCtx.topVarianceItems.slice(0,5) : [];
    const topRecipes = Array.isArray(aiCtx?.topSellingRecipes) ? aiCtx.topSellingRecipes.slice(0,3) : [];
    const dataQuality = aiCtx?.dataQuality || 'low';
    const venuePatterns = topVariance.length > 0
      ? 'Known variance patterns: ' + topVariance.map((v) => v.name + ' (' + v.avgVariancePct + '% avg variance)').join(', ')
      : null;
    const recipeContext = topRecipes.length > 0
      ? 'Top selling recipes: ' + topRecipes.map((r) => r.name + ' (' + r.totalSold + ' sold)').join(', ')
      : null;

    const contextLines = [
      "Product: " + productName,
      "On hand: " + onHand + " " + unit,
      "Expected: " + expected + " " + unit,
      "Variance: " + varStr,
      salesQty != null ? "Recent sales: " + salesQty + " " + unit : null,
      invoiceQty != null ? "Recently received: " + invoiceQty + " " + unit : null,
      shrinkUnits > 0 ? "Shrinkage recorded: " + shrinkUnits + " " + unit : null,
      costStr ? "Cost per unit: " + costStr : null,
      attributionRecipe ? "Recipe attribution: " + attributionRecipe + " accounts for " + attributionPct + "% of variance" : null,
      venuePatterns,
      recipeContext,
      dataQuality !== 'low' ? 'Venue data quality: ' + dataQuality + ' (' + (aiCtx?.stockCycleCount || 0) + ' stocktakes, ' + (aiCtx?.salesCycleCount || 0) + ' sales reports)' : null,
    ].filter(Boolean).join("\n");
    const raw = await callClaude(systemPrompt, "Explain this stock variance:\n\n" + contextLines);
    let parsed: any = {};
    try { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch { parsed = { summary: raw.slice(0, 300) }; }
    console.log("[api/variance-explain] OK", { uid, productName, variance });
    res.json({
      summary: parsed.summary || "No explanation available.",
      factors: Array.isArray(parsed.factors) ? parsed.factors : [],
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5,
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    });
  } catch (e: any) {
    console.error("[api/variance-explain] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Explanation failed" });
  }
});

// ── POST /generate-recipe ────────────────────────────────────────
// Body: { venueId, name, type: 'cocktail'|'drink'|'dish'|'batch', products: [{name,costPrice,unit,packSize,size}], suppliers: [{name}] }
// Returns: { ok: true, recipe, variants, ingredients, iceIngredient, pricing, batchRecipe }
app.post("/generate-recipe", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, name, type, products, suppliers } = req.body || {};
    if (!venueId || !name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ ok: false, error: "Missing venueId or name" });
      return;
    }
    await verifyVenueMembership(uid, venueId);

    // ── Global recipe cache — skip the AI call entirely on a hit ──────────────
    const recipeNameNorm = normNameForMatch(name);
    const globalRecipeRef = recipeNameNorm
      ? admin.firestore().doc(`global_recipes/${recipeNameNorm}`)
      : null;

    if (globalRecipeRef) {
      const cachedSnap = await globalRecipeRef.get();
      if (cachedSnap.exists) {
        console.log("[api/generate-recipe] cache hit", { uid, venueId, name, recipeNameNorm });
        res.json({ ok: true, ...cachedSnap.data(), _source: "global_recipes" });
        return;
      }
    }

    const lcRG = await checkAiLimit(venueId, 'recipe_generation');
    if (!lcRG.allowed) {
      res.status(429).json({
        ...lcRG.limitError,
        message: "Recipe generation limit reached for this month.",
      });
      return;
    }

    const recipeType: string = ['cocktail', 'drink', 'dish', 'batch'].includes(type) ? type : 'cocktail';
    const isCocktail = recipeType === 'cocktail' || recipeType === 'drink';

    const productList = Array.isArray(products) ? products.slice(0, 250) : [];
    const supplierList = Array.isArray(suppliers) ? suppliers.slice(0, 100) : [];

    const productLines = productList.map((p: any) => {
      const cost = Number(p?.costPrice ?? 0);
      const bits = [
        `${p?.name ?? 'Unnamed product'}`,
        `cost $${Number.isFinite(cost) ? cost.toFixed(2) : '0.00'} per ${p?.unit || 'unit'}`,
      ];
      if (p?.packSize) bits.push(`pack size ${p.packSize}`);
      if (p?.size) bits.push(`size ${p.size}`);
      return `- ${bits.join(" | ")}`;
    }).join("\n") || "(no products on file)";

    const supplierLines = supplierList.map((s: any) => `- ${s?.name ?? 'Unnamed supplier'}`).join("\n") || "(no suppliers on file)";

    const systemPrompt = [
      "You are an expert bar/kitchen consultant for Hosti, a hospitality inventory and recipe management app for NZ venues.",
      "Generate a complete, ready-to-use recipe specification matched to the venue's existing products wherever possible.",
      "",
      "Core principles:",
      "- Match ingredients to the venue's product list by name when there is a clear match. Use the EXACT product name from the list when matching.",
      "- If an ingredient cannot be matched to a venue product, mark it unmatched and suggest a supplier from the venue's supplier list if relevant (or null if none fit).",
      "- 'In-house' ingredients are things venues typically make/stock themselves (e.g. simple syrup, garnish, ice) that don't need a supplier match — mark isInHouse true for these.",
      "- Always include realistic NZ hospitality pricing (NZD).",
      "- The recipe must always be generated in full, complete, and ready to use. Missing products in the venue's inventory must never block or degrade the recipe output.",
      "- For every unmatched ingredient (not found in venue products and not in-house), put a plain-English suggestion in supplierSuggestion — if a reasonable alternative exists in the venue's product list, name it and explain why it works, e.g. \"We don't have Kahlúa in your products — Tia Maria or another coffee liqueur would work\". If no venue alternative exists, suggest a generic known substitute instead, e.g. \"any coffee liqueur\". supplierSuggestion should always be a plain English note, not just a supplier or product name.",
      "- GP and cost calculations run on whatever can be priced. Never omit or zero out the pricing block. Set pricing.isPartial to true if any ingredient is unmatched or has no cost, and set pricing.missingCount to the number of ingredients that couldn't be priced (0 and false when everything is priced).",
      "- bartenderNotes must always include a plain-English note naming any ingredients missing from the venue's inventory and pointing at the substitutes shown, e.g. \"Note: Kahlúa and Frangelico are not in your current products — add them or use the substitutes shown.\" Omit this note only if every ingredient matched or is in-house.",
      `- Recipe type is "${recipeType}".`,
      isCocktail
        ? "- Since this is a drink, include an iceIngredient block describing dilution % and ice handling."
        : "- Set iceIngredient to null for non-drink recipes.",
      "- If the request is ambiguous or could mean multiple distinct drinks/dishes (e.g. 'Margarita' could be Classic, Spicy, Frozen, Tommy's), return 2-4 variants. If there's really only one sensible interpretation, return a single variant.",
      "- Always include a batchRecipe scaled to 10 serves, with a short shelf life / storage note. For cocktails include a coldWaterMl figure for batch dilution.",
      "",
      "Respond with ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:",
      `{
  "recipe": {
    "name": "string",
    "method": "string - step by step, newline separated",
    "glassware": "string",
    "garnish": "string",
    "description": "string - 1 sentence",
    "bartenderNotes": "string - tips, substitutions, notes"
  },
  "variants": [
    {
      "name": "string",
      "differentiator": "string - what makes this variant different",
      "estimatedGpPct": number,
      "estimatedSellPrice": number
    }
  ],
  "ingredients": [
    {
      "name": "string",
      "qty": number,
      "unit": "ml" | "g" | "each",
      "matchedProductId": "string or null - use the exact product name from the venue list if matched, else null",
      "matchedProductName": "string or null",
      "costPerServe": number,
      "isInHouse": boolean,
      "supplierSuggestion": "string or null"
    }
  ],
  "iceIngredient": {
    "dilutionPct": number,
    "volumeNote": "string",
    "batchColdWaterNote": "string"
  } | null,
  "pricing": {
    "estimatedCostPerServe": number,
    "suggestedSellingPrice": number,
    "estimatedGpPct": number,
    "priceGuide": { "budget": number, "mid": number, "premium": number },
    "isPartial": boolean,
    "missingCount": number
  },
  "batchRecipe": {
    "serves": 10,
    "ingredients": [ { "name": "string", "qty": number, "unit": "string" } ],
    "coldWaterMl": number | null,
    "storageNotes": "string",
    "shelfLife": "string"
  }
}`,
      "",
      "For matchedProductId: since you don't have real product IDs, set it to the exact venue product name string when matched (the app will resolve this to the real ID), or null if unmatched.",
    ].filter(Boolean).join("\n");

    const userMessage = [
      `Generate a ${recipeType} recipe for: "${name.trim()}"`,
      "",
      "Venue products on file:",
      productLines,
      "",
      "Venue suppliers on file:",
      supplierLines,
    ].join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error("Claude API error: " + errText);
    }
    const data = await resp.json() as any;
    let raw: string = data?.content?.[0]?.text || "";
    raw = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    let recipeJson: any;
    try {
      recipeJson = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Could not parse AI response");
      recipeJson = JSON.parse(m[0]);
    }

    await trackAiCall(venueId, 'recipe_generation');
    console.log("[api/generate-recipe] OK", { uid, venueId, name, type: recipeType });

    const responseBody = { ok: true, ...recipeJson };

    if (globalRecipeRef) {
      try {
        await globalRecipeRef.set({
          ...responseBody,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: uid,
          recipeName: name.trim(),
          recipeType,
        }, { merge: true });
      } catch (e: any) {
        console.error("[api/generate-recipe] global_recipes cache write failed", e?.message || e);
      }
    }

    res.json(responseBody);
  } catch (e: any) {
    console.error("[api/generate-recipe] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Recipe generation failed" });
  }
});

// ── POST /suggest-orders ───────────────────────────────────────────
// AI call removed — math is now velocity-driven client-side.
// Endpoint kept for backwards compatibility; returns baseline as-is.
app.post("/suggest-orders", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, baseline } = req.body || {};
    if (!venueId || !baseline) { res.status(400).json({ ok: false, error: "Missing venueId or baseline" }); return; }
    console.log("[api/suggest-orders] returning baseline (math mode)", { uid, venueId });
    res.json({ ...baseline, insights: [], adjustments: [] });
  } catch (e: any) {
    console.error("[api/suggest-orders] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Suggestion failed" });
  }
});


// ── POST /budget-suggest ───────────────────────────────────────────
// Body: { venueId, aiContext }
// Returns: { suggestions: [{ supplierId, supplierName, suggestedAmount, period, reasoning, confidence }] }
app.post("/budget-suggest", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, aiContext } = req.body || {};
    if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
    await verifyVenueMembership(uid, venueId);
    const lcBS = await checkAiLimit(venueId, 'suggest_orders');
    if (!lcBS.allowed) { res.status(429).json(lcBS.limitError); return; }
    const ctx = aiContext || {};
    const supplierSpend = Array.isArray(ctx.supplierSpend) ? ctx.supplierSpend : [];
    const dataQuality = ctx.dataQuality || "low";
    const stockCycles = ctx.stockCycleCount || 0;
    const orderCycles = ctx.orderCycleCount || 0;
    const frequentShortages = Array.isArray(ctx.frequentShortages) ? ctx.frequentShortages : [];
    const topRecipes = Array.isArray(ctx.topSellingRecipes) ? ctx.topSellingRecipes : [];
    const systemPrompt = [
      "You are an AI budget advisor for Hosti, a hospitality inventory app for NZ bars and restaurants.",
      "Analyse the venue spending patterns and suggest appropriate monthly budgets per supplier.",
      "Be practical and specific. Base suggestions on actual spend data when available.",
      "Consider NZ hospitality patterns: busy weekends, seasonal trade, typical GP margins.",
      "If data quality is low, be conservative and say so.",
      "Respond ONLY with valid JSON:",
      '{ "suggestions": [{ "supplierId": "id", "supplierName": "name", "suggestedAmount": 1200, "periodDays": 30, "reasoning": "plain English reason", "confidence": 0.0-1.0 }], "overallNote": "general advice" }'
    ].join("\n");
    const spendSummary = supplierSpend.length > 0
      ? supplierSpend.map((s) => {
          const avgMonthly = s.orderCount > 0 ? (s.totalSpend / Math.max(1, orderCycles)) * 4 : 0;
          return s.name + ": total $" + s.totalSpend.toFixed(2) + " across " + s.orderCount + " orders, est monthly $" + avgMonthly.toFixed(2);
        }).join("\n")
      : "No supplier spend data yet";
    const shortagesSummary = frequentShortages.length > 0
      ? "Frequent shortages: " + frequentShortages.map((s) => s.name).join(", ")
      : "No frequent shortages recorded";
    const recipesSummary = topRecipes.length > 0
      ? "Top selling recipes: " + topRecipes.map((r) => r.name + " (" + r.totalSold + " sold)").join(", ")
      : "No recipe sales data yet";
    const userMsg = [
      "Venue ID: " + venueId,
      "Data quality: " + dataQuality,
      "Completed stocktakes: " + stockCycles,
      "Submitted orders: " + orderCycles,
      "",
      "Supplier spend history:",
      spendSummary,
      "",
      shortagesSummary,
      recipesSummary,
      "",
      "Suggest monthly budgets for each supplier. If data is low quality, suggest conservative amounts and explain why.",
    ].join("\n");
    const raw = await callClaude(systemPrompt, userMsg);
    let parsed: any = {};
    try { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch { parsed = {}; }
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.map((s: any) => ({
      supplierId: String(s.supplierId || ""),
      supplierName: String(s.supplierName || "Supplier"),
      suggestedAmount: Number.isFinite(s.suggestedAmount) ? Math.round(s.suggestedAmount) : 500,
      periodDays: Number.isFinite(s.periodDays) ? s.periodDays : 30,
      reasoning: String(s.reasoning || ""),
      confidence: Number.isFinite(s.confidence) ? s.confidence : 0.5,
    })) : [];
    const meter = await trackAiCall(venueId, 'suggest_orders');
    console.log("[api/budget-suggest] OK", { uid, venueId, meter });
    res.json({ ok: true, meter, suggestions, overallNote: parsed.overallNote || null, dataQuality });
  } catch (e: any) {
    console.error("[api/budget-suggest] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Budget suggestion failed" });
  }
});


// ── POST /ai-insights ────────────────────────────────────────────────────────
// Body: { venueId, data, cacheKey }
// Returns: { ok, insights: [{headline, observation, action}] }
app.post("/ai-insights", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, data, cacheKey } = req.body || {};
    if (!venueId || !data) { res.status(400).json({ ok: false, error: "Missing venueId or data" }); return; }
    await verifyVenueMembership(uid, venueId);
    const lcAI = await checkAiLimit(venueId, 'ai_insights');
    if (!lcAI.allowed) { res.status(429).json(lcAI.limitError); return; }

    // Enrich data with snapshot intelligence before sending to Claude
    let enrichedData = { ...data };
    try {
      const dbInst = admin.firestore();
      const deptsSnap = await dbInst.collection(`venues/${venueId}/departments`).get();
      const snapshotSummaries: any[] = [];
      for (const deptDoc of deptsSnap.docs) {
        const latestSnap = await dbInst
          .collection(`venues/${venueId}/departments/${deptDoc.id}/snapshots`)
          .orderBy('completedAt', 'desc')
          .limit(1)
          .get();
        if (!latestSnap.empty) {
          const s = latestSnap.docs[0].data() as any;
          snapshotSummaries.push({
            department: s.departmentName,
            cycleNumber: s.cycleNumber,
            tier: s.dataCompleteness?.tier ?? 1,
            summary: s.summary,
            topLosses: (s.items || [])
              .filter((i: any) => i.totalVarianceQty < 0)
              .sort((a: any, b: any) => a.totalVarianceQty - b.totalVarianceQty)
              .slice(0, 5)
              .map((i: any) => ({ name: i.name, varianceQty: i.totalVarianceQty, varianceDollars: i.totalVarianceDollars })),
            topGains: (s.items || [])
              .filter((i: any) => i.totalVarianceQty > 0)
              .sort((a: any, b: any) => b.totalVarianceQty - a.totalVarianceQty)
              .slice(0, 5)
              .map((i: any) => ({ name: i.name, varianceQty: i.totalVarianceQty, likelyMissingInvoice: i.likelyMissingInvoice })),
            findings: s.findings,
            recommendations: (s.recommendations || []).slice(0, 5),
          });
        }
      }
      if (snapshotSummaries.length > 0) enrichedData = { ...enrichedData, snapshotSummaries };
    } catch {}

    const systemPrompt = `You are a hospitality business advisor. You have been given stocktake variance data for a venue, including rich cycle snapshot data where available. Provide 2-4 concise, actionable insights based on this data. Each insight should have a short headline and 2-3 sentences. Be honest and direct. Never alarming. Always frame as 'consider this' not 'you must do this'. Focus on: significant variances by product, missing invoice patterns (gains without deliveries), items below PAR, supplier pricing opportunities, and what the data tier means for analysis quality. Be explicit about what data is and isn't available. Return as JSON array: [{headline, observation, action}]`;

    const userMessage = "Stocktake data for analysis:\n\n" + JSON.stringify(enrichedData, null, 2);

    const raw = await callClaude(systemPrompt, userMessage);

    let insights: any[] = [];
    try {
      const m = raw.match(/\[[\s\S]*\]/);
      insights = m ? JSON.parse(m[0]) : [];
    } catch { insights = []; }

    const cleaned = insights
      .filter((i: any) => i && i.headline && i.observation)
      .slice(0, 4)
      .map((i: any) => ({
        headline: String(i.headline),
        observation: String(i.observation),
        action: i.action ? String(i.action) : null,
      }));

    // Cache to Firestore for reuse across app opens
    if (cacheKey && cleaned.length > 0) {
      try {
        const db = admin.firestore();
        await db.doc(`venues/${venueId}/reports/aiInsights`).set({
          insights: cleaned,
          cacheKey,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.log("[api/ai-insights] cache write failed", e);
      }
    }

    await trackAiCall(venueId, "ai_insights");
    console.log("[api/ai-insights] OK", { uid, venueId, count: cleaned.length });
    res.json({ ok: true, insights: cleaned });
  } catch (e: any) {
    console.error("[api/ai-insights] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Insights generation failed" });
  }
});

// ── POST /extract-inventory ───────────────────────────────────────────────────
// Body: { imageBase64?: string, pdfBase64?: string, fileBase64?: string, mimeType: string, venueId?: string }
// Returns: { ok, lines: [{name, quantity, unit, area}] }
// Accepts any of imageBase64 / pdfBase64 / fileBase64; mimeType determines handling.
app.post("/extract-inventory", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { imageBase64, pdfBase64, fileBase64, mimeType, venueId, mode, imageBase64Back } = req.body || {};

    if (!venueId) {
      res.status(400).json({ error: "venueId is required." });
      return;
    }
    await verifyVenueMembership(uid, venueId);

    // Resolve the raw base64 and whether it's an image or PDF
    const rawBase64: string = imageBase64 || pdfBase64 || fileBase64 || "";
    if (!rawBase64) {
      res.status(400).json({ ok: false, error: "Missing imageBase64, pdfBase64, or fileBase64" });
      return;
    }

    // Mode-aware limit check
    if (mode !== 'catalogue') {
      const callTypeForMode: AiCallType =
        mode === 'shelf-scan' ? 'shelf_scan' :
        mode === 'product-photo' ? 'product_photo' : 'stocktake_photo';
      const lcEI = await checkAiLimit(venueId, callTypeForMode);
      if (!lcEI.allowed) { res.status(429).json(lcEI.limitError); return; }
    }

    const isImage = !!(imageBase64) || (!!mimeType && mimeType.startsWith("image/"));
    const resolvedMime: string = mimeType || (isImage ? "image/jpeg" : "application/pdf");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // System prompt varies by mode
    let systemPrompt: string;
    if (mode === "shelf-scan") {
      systemPrompt =
        "This is a photo of a bar or restaurant shelf with multiple products visible. " +
        "Identify every product you can see. For each product return name, brand (if visible), " +
        "size in ml or L (if visible), and category (spirits/wine/beer/cider/non-alcoholic/food/other). " +
        "Do not estimate counts — just identify what products are there. " +
        'Return as JSON array: [{"name":"...","brand":"...","size":"...","category":"..."}]. ' +
        "If you cannot identify a product clearly, omit it. Return only valid JSON, no preamble.";
    } else if (mode === "product-photo") {
      if (imageBase64Back) {
        // Two photos: front label + back label of the SAME bottle
        systemPrompt =
          "You are looking at TWO photos of the SAME product. " +
          "Photo 1 is the FRONT label — it shows the product name and brand. " +
          "Photo 2 is the BACK label — it shows the barcode, size, ABV, country of origin, and importer details. " +
          "Extract ONE product by combining information from BOTH photos. " +
          "NEVER return an array. Return exactly ONE JSON object: " +
          '{"name":"...","brand":"...","size":"...","category":"...","barcode":"...","unit":"...","abv":"...","countryOfOrigin":"...","importerName":"..."}. ' +
          "category must be one of: spirits/wine/beer/cider/non-alcoholic/food/other. " +
          "barcode: read the numeric barcode digits from the back label. " +
          "Return only valid JSON, no preamble.";
      } else {
        // Single photo: extract what is visible
        systemPrompt =
          "Extract product details from this single label photo. " +
          "NEVER return an array. Return exactly ONE JSON object: " +
          '{"name":"...","brand":"...","size":"...","category":"...","barcode":"...","unit":"...","abv":"..."}. ' +
          "category must be one of: spirits/wine/beer/cider/non-alcoholic/food/other. " +
          "Return only valid JSON, no preamble.";
      }
    } else if (mode === "catalogue") {
      systemPrompt =
        "This is a supplier product catalogue page. Extract all products visible. " +
        "For each product return: name, size, unit, category, SKU/code if visible, price if visible. " +
        'Return as JSON array: [{"name":"...","size":"...","unit":"...","category":"...","sku":"...","price":"..."}]. ' +
        "Return only valid JSON, no preamble.";
    } else {
      systemPrompt =
        "You are reading a hospitality stocktake sheet. " +
        "Extract all product names and quantities. " +
        "Return as JSON array: [{name, quantity, unit, area}]. " +
        "If area is not clear use 'General'. " +
        "Return only valid JSON, no preamble.";
    }

    let rawText = "";

    if (isImage) {
      // Vision path: send image(s) directly to Claude
      const imageContent: any[] = [
        { type: "image", source: { type: "base64", media_type: resolvedMime, data: rawBase64 } },
      ];
      if (mode === "product-photo" && imageBase64Back) {
        imageContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64Back } });
      }
      const promptText =
        mode === "shelf-scan" ? "Identify all products visible on this shelf." :
        mode === "product-photo" && imageBase64Back ? "These two photos are the front and back of the same product. Return one combined JSON object." :
        mode === "product-photo" ? "Extract all product details from this photo. Return one JSON object." :
        mode === "catalogue" ? "Extract all products from this catalogue page." :
        "Extract all items from this stocktake sheet.";
      imageContent.push({ type: "text", text: promptText });

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: imageContent }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        throw new Error("Claude vision error: " + err);
      }
      const data = await resp.json() as any;
      rawText = data?.content?.[0]?.text || "[]";
    } else {
      // PDF path: parse text with pdf-parse, then extract with Claude
      const pdfParse = require("pdf-parse");
      const buffer = Buffer.from(rawBase64, "base64");
      const pdfData = await pdfParse(buffer);
      const text = (pdfData.text || "").slice(0, 12000);

      // Detect scanned vs digital PDF — scanned PDFs have very little extractable text
      const pdfWordCount = text.trim().split(/\s+/).length;
      const pdfHasContent = /\d/.test(text) || /[a-zA-Z]/.test(text);
      if (pdfWordCount < 20 || !pdfHasContent) {
        console.log("[api/extract-inventory] Scanned PDF detected — returning guidance");
        res.json({
          ok: false,
          scannedPdf: true,
          message: "This PDF appears to be a scanned image rather than a digital document. For best results: upload a CSV or digital PDF export from your POS or spreadsheet.",
        });
        return;
      }
      console.log("[api/extract-inventory] Digital PDF — processing as text");

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: "Extract items from this stocktake sheet:\n\n" + text }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        throw new Error("Claude PDF error: " + err);
      }
      const data = await resp.json() as any;
      rawText = data?.content?.[0]?.text || "[]";
    }

    // Track usage (best-effort, non-blocking)
    if (venueId && mode !== 'catalogue') {
      const callTypeForMode: AiCallType =
        mode === 'shelf-scan' ? 'shelf_scan' :
        mode === 'product-photo' ? 'product_photo' : 'stocktake_photo';
      trackAiCall(venueId, callTypeForMode).catch(() => {});
    }

    // Parse response based on mode
    if (mode === "shelf-scan") {
      let products: any[] = [];
      try {
        const m = rawText.match(/\[[\s\S]*\]/);
        const parsed = m ? JSON.parse(m[0]) : [];
        products = (Array.isArray(parsed) ? parsed : [])
          .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
          .map((p: any) => ({
            name: String(p.name).trim(),
            brand: p.brand ? String(p.brand).trim() : "",
            size: p.size ? String(p.size).trim() : "",
            category: p.category ? String(p.category).trim() : "other",
          }));
      } catch {}
      console.log("[api/extract-inventory] shelf-scan OK", { uid, count: products.length });
      res.json({ ok: true, products, lines: [] });
    } else if (mode === "product-photo") {
      let product: any = {};
      try {
        const m = rawText.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : {};
        product = {
          name: String(parsed.name || "").trim(),
          brand: String(parsed.brand || "").trim(),
          size: String(parsed.size || "").trim(),
          category: String(parsed.category || "other").trim(),
          barcode: String(parsed.barcode || "").trim(),
          unit: String(parsed.unit || "bottle").trim(),
          abv: String(parsed.abv || "").trim(),
          countryOfOrigin: String(parsed.countryOfOrigin || "").trim(),
          importerName: String(parsed.importerName || "").trim(),
        };
      } catch {}
      console.log("[api/extract-inventory] product-photo OK", { uid, name: product.name, hasBarcode: !!product.barcode, dualPhoto: !!imageBase64Back });
      res.json({ ok: true, product, lines: [] });
    } else if (mode === "catalogue") {
      let products: any[] = [];
      try {
        const m = rawText.match(/\[[\s\S]*\]/);
        const parsed = m ? JSON.parse(m[0]) : [];
        products = (Array.isArray(parsed) ? parsed : [])
          .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
          .map((p: any) => ({
            name: String(p.name).trim(),
            size: p.size ? String(p.size).trim() : "",
            unit: p.unit ? String(p.unit).trim() : "",
            category: p.category ? String(p.category).trim() : "",
            sku: p.sku ? String(p.sku).trim() : "",
            price: p.price ? String(p.price).trim() : "",
          }));
      } catch {}
      console.log("[api/extract-inventory] catalogue OK", { uid, count: products.length });
      res.json({ ok: true, products, lines: [] });
    } else {
      // Default: stocktake sheet — returns ExtractionResult format matching client type
      let items: any[] = [];
      try {
        const m = rawText.match(/\[[\s\S]*\]/);
        items = m ? JSON.parse(m[0]) : [];
      } catch { items = []; }

      const products = items
        .filter((l: any) => l && typeof l.name === "string" && l.name.trim().length > 0)
        .map((l: any) => ({
          name: String(l.name).trim(),
          unit: l.unit ? String(l.unit).trim() : null,
          category: l.category ? String(l.category).trim() : null,
          area: l.area ? String(l.area).trim() : "General",
          department: l.department ? String(l.department).trim() : null,
          costPrice: Number.isFinite(Number(l.costPrice)) ? Number(l.costPrice) : null,
          parLevel: Number.isFinite(Number(l.quantity)) && Number(l.quantity) > 0 ? Number(l.quantity) : null,
          confidence: "medium",
        }));

      const inferredAreas = [...new Set(products.map((p: any) => p.area).filter(Boolean))] as string[];
      const inferredDepartments = [...new Set(products.map((p: any) => p.department).filter(Boolean))] as string[];
      const hasPricing = products.some((p: any) => p.costPrice != null);
      const hasStructure = products.some((p: any) => (p.area && p.area !== "General") || p.department);

      console.log("[api/extract-inventory] OK", { uid, source: isImage ? "image" : "pdf", count: products.length });
      res.json({
        ok: true,
        products,
        inferredAreas,
        inferredDepartments,
        hasPricing,
        hasStructure,
        summary: `Found ${products.length} product${products.length !== 1 ? "s" : ""}`,
        warnings: [],
      });
    }

  } catch (e: any) {
    console.error("[api/extract-inventory] ERROR", e?.message || e);
    // Graceful failure — return empty array, not a 500, so the client can skip gracefully
    res.json({ ok: false, lines: [], error: e?.message || "Extraction failed" });
  }
});

// ── Claude-powered invoice line extraction ───────────────────────

// ── extractInvoiceComplete ─────────────────────────────────────────────────────
// Single comprehensive Claude call that extracts supplier, customer, metadata
// and product lines from invoice text in one pass.
// NOTE: This function has no HTTP endpoint caller — it is dead code.
// Safe to delete in a future cleanup pass. The active extraction path is
// extractInvoiceWithClaude() in ocrInvoicePhoto.ts (the onCall callable).

type CompleteInvoiceExtraction = {
  supplier: {
    name: string | null; phone: string | null; email: string | null;
    address: string | null; website: string | null; accountNumber: string | null;
  };
  customer: { name: string | null; address: string | null; };
  invoice: {
    number: string | null; date: string | null; deliveryDate: string | null;
    poNumber: string | null; total: number | null; gst: number | null; subtotal: number | null;
  };
  lines: Array<{
    name: string; code: string | null; qty: number; unit: string | null;
    unitPrice: number | null; lineTotal: number | null; caseSize: number | null;
  }>;
};

async function extractInvoiceComplete(text: string): Promise<CompleteInvoiceExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const system = [
    "Analyse this invoice completely and extract ALL of the following in one pass:",
    "",
    "1. SUPPLIER (vendor who ISSUED this invoice):",
    "   name, address, phone, email, website, accountNumber (customer's account with supplier)",
    "",
    "2. CUSTOMER (who the invoice is addressed TO):",
    "   name, address (for wrong-venue detection)",
    "",
    "3. INVOICE METADATA:",
    "   invoiceNumber, invoiceDate, deliveryDate, purchaseOrderNumber, totalAmount, gstAmount, subtotal",
    "",
    "4. PRODUCT LINES (physical products only):",
    "   name, code, quantity, unit, unitPrice, lineTotal, caseSize (if mentioned)",
    "   SKIP: dates, totals, GST, freight, reference numbers, document labels",
    "",
    'Return as single JSON object: {"supplier":{"name":null,"phone":null,"email":null,"address":null,"website":null,"accountNumber":null},"customer":{"name":null,"address":null},"invoice":{"number":null,"date":null,"deliveryDate":null,"poNumber":null,"total":null,"gst":null,"subtotal":null},"lines":[{"name":"","code":null,"qty":1,"unit":null,"unitPrice":null,"lineTotal":null,"caseSize":null}]}',
    "",
    "IMPORTANT:",
    "- supplier is the VENDOR (large logo/name at top of invoice, the company sending the invoice)",
    "- customer is the RECIPIENT (delivery address or bill-to — the bar/restaurant receiving goods)",
    "- Only include physical product lines with a real product name and positive qty",
    "- Return ONE JSON object, no arrays at top level",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: "Extract all invoice data:\n\n" + text.slice(0, 12000) }],
    }),
  });
  if (!resp.ok) throw new Error("Claude invoice-complete error: " + resp.status);
  const data = await resp.json() as any;
  const rawText = data?.content?.[0]?.text || "{}";
  const match = rawText.match(/\{[\s\S]*\}/);
  const p = match ? JSON.parse(match[0]) : {};

  const lines = Array.isArray(p.lines)
    ? p.lines
        .filter((l: any) => l && l.name && Number(l.qty) > 0)
        .map((l: any) => ({
          name: String(l.name).trim(),
          code: l.code ? String(l.code).trim() : null,
          qty: Number(l.qty),
          unit: l.unit ? String(l.unit).trim() : null,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
          lineTotal: l.lineTotal != null ? Number(l.lineTotal) : null,
          caseSize: l.caseSize != null ? Number(l.caseSize) : null,
        }))
    : [];

  return {
    supplier: {
      name: p.supplier?.name ? String(p.supplier.name).trim() : null,
      phone: p.supplier?.phone ? String(p.supplier.phone).trim() : null,
      email: p.supplier?.email ? String(p.supplier.email).trim() : null,
      address: p.supplier?.address ? String(p.supplier.address).trim() : null,
      website: p.supplier?.website ? String(p.supplier.website).trim() : null,
      accountNumber: p.supplier?.accountNumber ? String(p.supplier.accountNumber).trim() : null,
    },
    customer: {
      name: p.customer?.name ? String(p.customer.name).trim() : null,
      address: p.customer?.address ? String(p.customer.address).trim() : null,
    },
    invoice: {
      number: p.invoice?.number ? String(p.invoice.number).trim() : null,
      date: p.invoice?.date ? String(p.invoice.date).trim() : null,
      deliveryDate: p.invoice?.deliveryDate ? String(p.invoice.deliveryDate).trim() : null,
      poNumber: p.invoice?.poNumber ? String(p.invoice.poNumber).trim() : null,
      total: Number.isFinite(Number(p.invoice?.total)) ? Number(p.invoice.total) : null,
      gst: Number.isFinite(Number(p.invoice?.gst)) ? Number(p.invoice.gst) : null,
      subtotal: Number.isFinite(Number(p.invoice?.subtotal)) ? Number(p.invoice.subtotal) : null,
    },
    lines,
  };
}

// ── POST /photo-count ─────────────────────────────────────────────────
// Body: { venueId, imageBase64, productHint?, unit?, mode? }
// mode: 'bottle-level' estimates fill level (0.0–1.0) instead of counting discrete units.
// Returns: { estimatedCount, confidence, reasoning, productName?, suggestions }
//      or: { mode: 'bottle-level', fillLevel, confidence, reasoning, productHint }
app.post("/photo-count", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, imageBase64, productHint, unit, mode } = req.body || {};
    if (!venueId || !imageBase64) { res.status(400).json({ ok: false, error: "Missing venueId or imageBase64" }); return; }
    await verifyVenueMembership(uid, venueId);
    const lcPC = await checkAiLimit(venueId, 'stocktake_photo');
    if (!lcPC.allowed) { res.status(429).json(lcPC.limitError); return; }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const isBottleLevel = mode === 'bottle-level';
    const systemPrompt = isBottleLevel
      ? [
          "You are estimating how full a spirit bottle is from a photo.",
          'Return ONLY a JSON object: { "fillLevel": <number>, "confidence": <number>, "reasoning": "<string>" }',
          "fillLevel must be between 0.0 (completely empty) and 1.0 (completely full, sealed or just opened),",
          "in increments of 0.05. Examples: 1.0 = full/sealed, 0.75 = three-quarters full, 0.5 = half full,",
          "0.25 = quarter full, 0.0 = empty.",
          "confidence is 0.0–1.0. reasoning is one sentence explaining what you can see.",
          `The bottle in the photo is a ${productHint || 'spirit bottle'}.`,
          "Consider the bottle shape — liquid level at the visual midpoint may not be exactly 0.5 by volume",
          "if the bottle tapers. Estimate by volume not by visual height.",
          "Return ONLY the JSON object, no other text.",
        ].join("\n")
      : [
          "You are an expert hospitality inventory counter for NZ bars and restaurants.",
          "Analyse the photo and count the visible stock items.",
          "Be specific about what you see. Count individual units, not cases unless asked.",
          "Consider: bottles behind bar, cans in fridge, kegs, dry goods, produce.",
          productHint ? "The user is counting: " + productHint : "Identify the main product visible.",
          unit ? "Count in units of: " + unit : "Count individual units.",
          "Respond ONLY with valid JSON:",
          '{ "estimatedCount": 12, "confidence": 0.85, "productName": "what you see", "reasoning": "I can see X rows of Y bottles", "suggestions": ["tip 1", "tip 2"] }'
        ].filter(Boolean).join("\n");
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [{
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
          }, {
            type: "text",
            text: isBottleLevel
              ? "Estimate the fill level of this bottle."
              : (productHint ? "Count the " + productHint + " visible in this image." : "Count the stock items visible in this image."),
          }],
        }],
      }),
    });
    if (!resp.ok) { const e = await resp.text().catch(() => ""); throw new Error("Claude error: " + e); }
    const data = await resp.json() as any;
    const text = data?.content?.[0]?.text || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    try { parsed = match ? JSON.parse(match[0]) : {}; } catch { parsed = {}; }
    // Log correction data for learning (venueId + hint + result)
    trackAiCall(venueId, 'stocktake_photo').catch(() => {});

    if (isBottleLevel) {
      console.log("[api/photo-count] OK (bottle-level)", { uid, venueId, productHint, fillLevel: parsed.fillLevel, confidence: parsed.confidence });
      res.json({
        ok: true,
        mode: 'bottle-level',
        fillLevel: Number.isFinite(parsed.fillLevel) ? parsed.fillLevel : null,
        confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
        reasoning: parsed.reasoning || null,
        productHint: productHint || null,
      });
      return;
    }

    console.log("[api/photo-count] OK", { uid, venueId, productHint, estimatedCount: parsed.estimatedCount, confidence: parsed.confidence });
    res.json({
      ok: true,
      estimatedCount: Number.isFinite(parsed.estimatedCount) ? Math.round(parsed.estimatedCount) : 0,
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      productName: parsed.productName || productHint || null,
      reasoning: parsed.reasoning || null,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    });
  } catch (e: any) {
    console.error("[api/photo-count] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Photo count failed" });
  }
});

// ── Stripe ───────────────────────────────────────────────────────────────────
// Initialised lazily — null when STRIPE_SECRET_KEY is not yet in Secret Manager.
// All endpoints check for null and return 503 so pilots are unaffected.

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" as any }) : null;

// POST /stripe/create-checkout-session
app.post("/stripe/create-checkout-session", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, priceId, successUrl, cancelUrl } = req.body || {};
    if (!venueId || !priceId || !successUrl || !cancelUrl) {
      res.status(400).json({ ok: false, error: "Missing venueId, priceId, successUrl, or cancelUrl" });
      return;
    }
    if (!stripe) { res.status(503).json({ error: "Billing not yet configured" }); return; }
    const db = admin.firestore();
    const venueSnap = await db.doc(`venues/${venueId}`).get();
    const existingCustomerId: string | undefined = venueSnap.data()?.subscription?.stripeCustomerId;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: venueId,
      ...(existingCustomerId ? { customer: existingCustomerId } : {}),
      metadata: { venueId, uid },
    });
    console.log("[api/stripe/create-checkout-session] OK", { uid, venueId, sessionId: session.id });
    res.json({ ok: true, sessionId: session.id, url: session.url });
  } catch (e: any) {
    console.error("[api/stripe/create-checkout-session] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Checkout session creation failed" });
  }
});

// POST /stripe/webhook
app.post("/stripe/webhook", async (req, res) => {
  if (!stripe) { res.status(503).json({ error: "Billing not yet configured" }); return; }
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[api/stripe/webhook] STRIPE_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "Billing not yet configured" });
    return;
  }
  let event: any;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody || Buffer.from(JSON.stringify(req.body)), sig as string, webhookSecret);
  } catch (e: any) {
    console.error("[api/stripe/webhook] Signature verification failed", e?.message);
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }
  const db = admin.firestore();
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const venueId = session.client_reference_id || (session.metadata as any)?.venueId;
      if (venueId) {
        let subData: any = null;
        if (session.subscription) {
          try { subData = await stripe.subscriptions.retrieve(session.subscription as string); } catch {}
        }
        await db.doc(`venues/${venueId}`).set({
          subscription: {
            status: "active",
            plan: "core",
            modules: [],
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            currentPeriodEnd: subData ? new Date((subData as any).current_period_end * 1000).toISOString() : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        console.log("[api/stripe/webhook] checkout.session.completed", { venueId });
      }
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as any;
      const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id;
      const venuesSnap = await db.collection("venues").where("subscription.stripeCustomerId", "==", customerId).limit(1).get();
      if (!venuesSnap.empty) {
        const venueDoc = venuesSnap.docs[0];
        const planMeta = (sub.items?.data?.[0]?.price?.metadata as any)?.plan || "core";
        const modules = (sub.items?.data || []).map((item: any) => item.price?.metadata?.module).filter(Boolean);
        await venueDoc.ref.set({
          subscription: {
            status: sub.status === "active" ? "active" : sub.status,
            plan: planMeta,
            modules,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000).toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        console.log("[api/stripe/webhook] subscription.updated", { venueId: venueDoc.id, status: sub.status });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as any;
      const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id;
      const venuesSnap = await db.collection("venues").where("subscription.stripeCustomerId", "==", customerId).limit(1).get();
      if (!venuesSnap.empty) {
        const venueDoc = venuesSnap.docs[0];
        await venueDoc.ref.set({
          subscription: {
            status: "cancelled",
            plan: null,
            modules: [],
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date((sub as any).current_period_end * 1000).toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        console.log("[api/stripe/webhook] subscription.deleted", { venueId: venueDoc.id });
      }
    }
  } catch (e: any) {
    console.error("[api/stripe/webhook] Handler error", e?.message);
  }
  res.json({ received: true });
});

// GET /stripe/portal
app.get("/stripe/portal", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, returnUrl } = req.query as Record<string, string>;
    if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
    const db = admin.firestore();
    const venueSnap = await db.doc(`venues/${venueId}`).get();
    const customerId: string | undefined = venueSnap.data()?.subscription?.stripeCustomerId;
    if (!customerId) {
      res.status(400).json({ ok: false, error: "No Stripe customer found for this venue" });
      return;
    }
    if (!stripe) { res.status(503).json({ error: "Billing not yet configured" }); return; }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || "https://hostistock.com",
    });
    console.log("[api/stripe/portal] OK", { uid, venueId });
    res.json({ ok: true, url: portalSession.url });
  } catch (e: any) {
    console.error("[api/stripe/portal] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Portal session creation failed" });
  }
});

// ── MYOB Business ────────────────────────────────────────────────────────────
// Structure ready, activation pending MYOB developer account registration and
// sandbox testing. Mirrors the Stripe lazy-init pattern above: every endpoint
// checks myobIsActivated() first and returns a clear, non-throwing response —
// nothing else in this file is affected while credentials are placeholders,
// and there is no risk of accidentally calling MYOB's real API with them.
//
// OAuth2 + API details confirmed against MYOB's own docs (not guessed — their
// flow differs from Xero's):
// - Authorize:            https://secure.myob.com/oauth2/account/authorize
// - Token exchange/refresh: https://secure.myob.com/oauth2/v1/authorize
//   (POST, application/x-www-form-urlencoded body, not query params)
// - Access token lifetime: 1200s (20 min). Refresh token: ~1 week.
// - Required API headers: Authorization: Bearer <token>, x-myobapi-key: <API key>,
//   x-myobapi-version: v2
// - Data API base: https://api.myob.com/accountright/{companyFileId}/...

// TODO: replace with real MYOB developer credentials once the app is registered.
const MYOB_CLIENT_ID = process.env.MYOB_CLIENT_ID || "YOUR_MYOB_CLIENT_ID";
const MYOB_CLIENT_SECRET = process.env.MYOB_CLIENT_SECRET || "YOUR_MYOB_CLIENT_SECRET";
const MYOB_API_KEY = process.env.MYOB_API_KEY || "YOUR_MYOB_API_KEY";
const MYOB_TOKEN_URL = "https://secure.myob.com/oauth2/v1/authorize";
const MYOB_API_BASE = "https://api.myob.com/accountright";

function myobIsActivated(): boolean {
  return (
    MYOB_CLIENT_ID !== "YOUR_MYOB_CLIENT_ID" &&
    MYOB_CLIENT_SECRET !== "YOUR_MYOB_CLIENT_SECRET" &&
    MYOB_API_KEY !== "YOUR_MYOB_API_KEY"
  );
}

type MYOBTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
};

// Tokens are stored server-side only, in a collection with no Firestore
// client rule at all (venues/{venueId}/integrationTokens/myob) — this
// function (via the Admin SDK, which bypasses security rules) is the only
// way in or out. The client-visible venues/{venueId}/integrations/myob doc
// never holds raw tokens, only connection status metadata.
async function getMyobTokens(venueId: string): Promise<MYOBTokens | null> {
  const snap = await admin.firestore().doc(`venues/${venueId}/integrationTokens/myob`).get();
  return snap.exists ? (snap.data() as MYOBTokens) : null;
}

async function storeMyobTokens(venueId: string, tokens: MYOBTokens): Promise<void> {
  await admin.firestore().doc(`venues/${venueId}/integrationTokens/myob`).set(tokens, { merge: true });
}

// Returns a valid access token, refreshing first if it's expired (or about
// to expire within 60s). Updates stored tokens in place. Returns null if
// there's no connection to refresh.
async function getValidMyobAccessToken(venueId: string): Promise<string | null> {
  const tokens = await getMyobTokens(venueId);
  if (!tokens) return null;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
    return tokens.accessToken;
  }
  const resp = await fetch(MYOB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MYOB_CLIENT_ID,
      client_secret: MYOB_CLIENT_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!resp.ok) {
    console.error("[myob] token refresh failed", await resp.text().catch(() => ""));
    return null;
  }
  const data: any = await resp.json();
  const newTokens: MYOBTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: new Date(Date.now() + (Number(data.expires_in) || 1200) * 1000).toISOString(),
  };
  await storeMyobTokens(venueId, newTokens);
  return newTokens.accessToken;
}

// Decides Bill_Layout from the order/invoice's own line data: 'Item' when at
// least one line is linked to a stock-tracked product (productId set —
// matches src/services/orders/drafts.ts OrderLine and the 'product' case of
// src/services/invoices/types.ts InvoiceLineType), otherwise 'Service' for
// freeform/non-stock charges (freight, surcharges, etc.).
function myobLayoutForLines(lines: any[]): "Item" | "Service" {
  return lines.some((l) => !!l?.productId) ? "Item" : "Service";
}

function myobBillLinesPayload(lines: any[], layout: "Item" | "Service") {
  return lines.map((l: any) => {
    const qty = Number(l.qty ?? 0);
    const unitCost = Number(l.cost ?? l.unitCost ?? 0);
    return {
      Description: l.productName || l.name || "Item",
      ...(layout === "Item"
        ? { ShipQuantity: qty, UnitPrice: unitCost }
        : { Total: qty * unitCost }),
    };
  });
}

async function postMyobBill(
  companyFileId: string,
  accessToken: string,
  layout: "Item" | "Service",
  payload: any
): Promise<{ ok: boolean; billId?: string; error?: string }> {
  const resp = await fetch(`${MYOB_API_BASE}/${companyFileId}/Purchase/Bill/${layout}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-myobapi-key": MYOB_API_KEY,
      "x-myobapi-version": "v2",
    },
    body: JSON.stringify(payload),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { ok: false, error: data?.Errors?.[0]?.Message || "MYOB API error" };
  }
  return { ok: true, billId: data.UID };
}

// POST /myob/callback — OAuth2 callback handler. Exchanges the authorization
// code for access + refresh tokens and persists the connection. This is the
// piece Xero's equivalent flow never built — make sure it actually persists.
app.post("/myob/callback", async (req, res) => {
  try {
    if (!myobIsActivated()) {
      res.json({ ok: false, error: "MYOB integration not yet activated" });
      return;
    }
    const { code, state, businessId, companyFileName } = req.body || {};
    if (!code || !state) {
      res.status(400).json({ ok: false, error: "Missing code or state" });
      return;
    }
    let venueId: string | undefined;
    try { venueId = JSON.parse(state)?.venueId; } catch { /* malformed state */ }
    if (!venueId) {
      res.status(400).json({ ok: false, error: "Missing venueId in state" });
      return;
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/myob/callback`;
    const tokenResp = await fetch(MYOB_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MYOB_CLIENT_ID,
        client_secret: MYOB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        scope: "CompanyFile",
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokenData: any = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error("[api/myob/callback] token exchange failed", tokenData);
      res.status(500).json({ ok: false, error: tokenData?.error_description || "Token exchange failed" });
      return;
    }

    // MYOB tokens: access token expires in 20 minutes, refresh token lasts 1 week.
    const expiresAt = new Date(Date.now() + (Number(tokenData.expires_in) || 1200) * 1000).toISOString();
    await storeMyobTokens(venueId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
    });

    // Client-visible connection status — no tokens stored here.
    await admin.firestore().doc(`venues/${venueId}/integrations/myob`).set({
      status: "connected",
      companyFileId: businessId || null,
      companyFileName: companyFileName || null,
      connectedAt: new Date().toISOString(),
      expiresAt,
    }, { merge: true });

    console.log("[api/myob/callback] OK", { venueId, businessId });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/myob/callback] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Callback failed" });
  }
});

// POST /myob/push-bill — push a placed order to MYOB as a Bill
app.post("/myob/push-bill", async (req, res) => {
  try {
    if (!myobIsActivated()) {
      res.json({ ok: false, error: "MYOB integration not yet activated" });
      return;
    }
    const { venueId, orderId, companyFileId } = req.body || {};
    if (!venueId || !orderId || !companyFileId) {
      res.status(400).json({ ok: false, error: "Missing venueId, orderId, or companyFileId" });
      return;
    }

    const accessToken = await getValidMyobAccessToken(venueId);
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "MYOB not connected for this venue" });
      return;
    }

    const orderSnap = await admin.firestore().doc(`venues/${venueId}/orders/${orderId}`).get();
    if (!orderSnap.exists) {
      res.status(404).json({ ok: false, error: "Order not found" });
      return;
    }
    const order = orderSnap.data() as any;
    const lines: any[] = Array.isArray(order?.lines) ? order.lines : [];
    const layout = myobLayoutForLines(lines);

    const result = await postMyobBill(companyFileId, accessToken, layout, {
      Date: new Date().toISOString().slice(0, 10),
      Lines: myobBillLinesPayload(lines, layout),
    });
    if (!result.ok) {
      console.error("[api/myob/push-bill] MYOB API error", result.error);
      res.status(502).json({ ok: false, error: result.error });
      return;
    }

    console.log("[api/myob/push-bill] OK", { venueId, orderId, layout });
    res.json({ ok: true, billId: result.billId });
  } catch (e: any) {
    console.error("[api/myob/push-bill] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Push failed" });
  }
});

// POST /myob/push-invoice — push a received/matched invoice to MYOB as a Bill
app.post("/myob/push-invoice", async (req, res) => {
  try {
    if (!myobIsActivated()) {
      res.json({ ok: false, error: "MYOB integration not yet activated" });
      return;
    }
    const { venueId, invoiceId, companyFileId } = req.body || {};
    if (!venueId || !invoiceId || !companyFileId) {
      res.status(400).json({ ok: false, error: "Missing venueId, invoiceId, or companyFileId" });
      return;
    }

    const accessToken = await getValidMyobAccessToken(venueId);
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "MYOB not connected for this venue" });
      return;
    }

    const db = admin.firestore();
    const invoiceSnap = await db.doc(`venues/${venueId}/invoices/${invoiceId}`).get();
    if (!invoiceSnap.exists) {
      res.status(404).json({ ok: false, error: "Invoice not found" });
      return;
    }
    const linesSnap = await db.collection(`venues/${venueId}/invoices/${invoiceId}/lines`).get();
    const lines = linesSnap.docs.map((d) => d.data());
    const layout = myobLayoutForLines(lines);

    const invoice = invoiceSnap.data() as any;
    const result = await postMyobBill(companyFileId, accessToken, layout, {
      Date: invoice?.date?.toDate ? invoice.date.toDate().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      Lines: myobBillLinesPayload(lines, layout),
    });
    if (!result.ok) {
      console.error("[api/myob/push-invoice] MYOB API error", result.error);
      res.status(502).json({ ok: false, error: result.error });
      return;
    }

    console.log("[api/myob/push-invoice] OK", { venueId, invoiceId, layout });
    res.json({ ok: true, billId: result.billId });
  } catch (e: any) {
    console.error("[api/myob/push-invoice] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Push failed" });
  }
});

// ── Square POS ────────────────────────────────────────────────────────────────
// Mirrors the MYOB Business pattern above: structure built and ready, gated
// inert behind squareIsActivated() until real Square developer credentials
// replace the placeholders. Mobile client uses PKCE for the authorization-code
// exchange (no client_secret on-device); this Cloud Function holds the secret
// for token refresh and is the only thing that ever sees the access token.

// TODO: replace with real Square developer credentials once the app is registered.
const SQUARE_APP_ID = process.env.SQUARE_APP_ID || "YOUR_SQUARE_APP_ID";
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || "YOUR_SQUARE_APP_SECRET";
const SQUARE_VERSION = "2026-05-20";
const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_SANDBOX_TOKEN = process.env.SQUARE_SANDBOX_ACCESS_TOKEN || functions.config().square?.sandbox_token || '';
const SQUARE_IS_SANDBOX = SQUARE_APP_ID.startsWith('sandbox-') || !!SQUARE_SANDBOX_TOKEN;
const SQUARE_API_BASE_RESOLVED = SQUARE_IS_SANDBOX
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';

function squareIsActivated(): boolean {
  return (
    SQUARE_APP_ID !== "YOUR_SQUARE_APP_ID" &&
    SQUARE_APP_SECRET !== "YOUR_SQUARE_APP_SECRET"
  );
}

type SquareTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp — Square's token response gives this directly
  merchantId: string | null;
  locationId: string | null;
  connectedAt: string;
};

// Tokens are stored server-side only, in a collection with no Firestore client
// rule at all (venues/{venueId}/integrationTokens/square) — this function (via
// the Admin SDK, which bypasses security rules) is the only way in or out. The
// client-visible venues/{venueId}/posIntegration/config doc never holds tokens,
// only connection status metadata.
async function getSquareTokens(venueId: string): Promise<SquareTokens | null> {
  const snap = await admin.firestore().doc(`venues/${venueId}/integrationTokens/square`).get();
  return snap.exists ? (snap.data() as SquareTokens) : null;
}

async function storeSquareTokens(venueId: string, tokens: SquareTokens): Promise<void> {
  await admin.firestore().doc(`venues/${venueId}/integrationTokens/square`).set(tokens, { merge: true });
}

// Returns a valid access token, refreshing first if it's within refreshThresholdMs
// of expiry. Updates stored tokens in place. Returns null if there's no connection.
async function getValidSquareAccessToken(venueId: string, refreshThresholdMs: number): Promise<string | null> {
  const tokens = await getSquareTokens(venueId);
  if (!tokens) return null;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > refreshThresholdMs) {
    return tokens.accessToken;
  }
  const resp = await fetch(`${SQUARE_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({
      client_id: SQUARE_APP_ID,
      client_secret: SQUARE_APP_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    console.error("[square] token refresh failed", await resp.text().catch(() => ""));
    return null;
  }
  const data: any = await resp.json();
  const newTokens: SquareTokens = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: data.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  await storeSquareTokens(venueId, newTokens);
  return newTokens.accessToken;
}

// Fetches every page of Square's Catalog List API (types=ITEM,CATEGORY — both
// in the same call so item.category_id can be resolved to a category name
// without a second round trip).
async function fetchAllSquareCatalogObjects(accessToken: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${SQUARE_API_BASE}/v2/catalog/list`);
    url.searchParams.set("types", "ITEM,CATEGORY");
    if (cursor) url.searchParams.set("cursor", cursor);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION },
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.errors?.[0]?.detail || "Square catalog fetch failed");
    }
    all.push(...(data.objects || []));
    cursor = data.cursor;
  } while (cursor);
  return all;
}

// Maps Square CatalogObject[] (ITEM + CATEGORY) to POSSaleItem[] — see
// src/services/pos/POSService.ts for the shape this must match.
function mapSquareCatalogToSaleItems(objects: any[]): Array<{
  posItemId: string; posItemName: string; posSku: string | null; category: string | null; sellPrice: number | null;
}> {
  const categoryNames = new Map<string, string>();
  for (const obj of objects) {
    if (obj.type === "CATEGORY" && obj.category_data?.name) {
      categoryNames.set(obj.id, obj.category_data.name);
    }
  }
  const items: Array<{ posItemId: string; posItemName: string; posSku: string | null; category: string | null; sellPrice: number | null }> = [];
  for (const obj of objects) {
    if (obj.type !== "ITEM") continue;
    const itemData = obj.item_data || {};
    const variations: any[] = itemData.variations || [];
    const firstVariation = variations[0]?.item_variation_data || {};
    const priceMoney = firstVariation.price_money;
    items.push({
      posItemId: obj.id,
      posItemName: itemData.name || "Unnamed item",
      posSku: firstVariation.sku || null,
      category: itemData.category_id ? (categoryNames.get(itemData.category_id) || null) : null,
      sellPrice: priceMoney?.amount != null ? priceMoney.amount / 100 : null,
    });
  }
  return items;
}

// GET /square/status — connection status for a venue, refreshing the token
// first if it's within 24h of expiry.
app.get("/square/status", async (req, res) => {
  try {
    if (!squareIsActivated()) {
      res.json({ ok: false, error: "Square integration not yet activated" });
      return;
    }
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const venueId = String(req.query.venueId || "");
    if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
    await verifyVenueMembership(uid, venueId);

    const accessToken = await getValidSquareAccessToken(venueId, 24 * 60 * 60 * 1000);
    if (!accessToken) {
      res.json({ ok: true, connected: false });
      return;
    }
    const tokens = await getSquareTokens(venueId);
    res.json({ ok: true, connected: true, locationId: tokens?.locationId, expiresAt: tokens?.expiresAt });
  } catch (e: any) {
    console.error("[api/square/status] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Status check failed" });
  }
});

// ── GET /square/oauth-callback ───────────────────────────────────────────────
// Square redirects here after merchant authorises. Reads code_verifier from
// Firestore, exchanges code for access token, stores token, redirects to app.
app.get("/square/oauth-callback", async (req, res) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      console.error('[square/oauth-callback] OAuth error:', error);
      res.redirect(`tallyup://square-callback?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect('tallyup://square-callback?error=missing_params');
      return;
    }

    const venueId = state;

    // Read code_verifier from Firestore
    const verifierDoc = await admin.firestore().doc(`squarePkceVerifiers/${venueId}`).get();
    if (!verifierDoc.exists) {
      console.error('[square/oauth-callback] No verifier for venueId:', venueId);
      res.redirect('tallyup://square-callback?error=verifier_not_found');
      return;
    }
    const codeVerifier = verifierDoc.data()?.verifier;
    await admin.firestore().doc(`squarePkceVerifiers/${venueId}`).delete().catch(() => {});

    if (!squareIsActivated()) {
      res.redirect('tallyup://square-callback?error=not_configured');
      return;
    }

    // Exchange code for token
    const tokenResp = await fetch(`${SQUARE_API_BASE_RESOLVED}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
      },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
      }),
    });
    const tokenData: any = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error('[square/oauth-callback] token exchange failed', tokenData);
      res.redirect('tallyup://square-callback?error=token_exchange_failed');
      return;
    }

    const accessToken = tokenData.access_token;
    const expiresAt = tokenData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const merchantId = tokenData.merchant_id || '';

    // Fetch location
    const locResp = await fetch(`${SQUARE_API_BASE_RESOLVED}/v2/locations`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': SQUARE_VERSION,
      },
    });
    const locData: any = await locResp.json().catch(() => ({}));
    const location = locData?.locations?.[0];
    const locationId = location?.id || '';

    // Write to Firestore
    const firestore = admin.firestore();
    const batch = firestore.batch();
    batch.set(firestore.doc(`venues/${venueId}/integrationTokens/square`), {
      accessToken,
      expiresAt,
      merchantId,
      locationId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(firestore.doc(`venues/${venueId}/posIntegration/config`), {
      adapter: 'square',
      merchantId,
      locationId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'connected',
    }, { merge: true });
    // Merchant lookup for webhooks
    batch.set(firestore.doc(`squareMerchants/${merchantId}`), {
      venueId,
      locationId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log('[square/oauth-callback] connected', { venueId, merchantId, locationId });
    res.redirect(`tallyup://square-callback?success=true&venueId=${encodeURIComponent(venueId)}`);
  } catch (e: any) {
    console.error('[square/oauth-callback] ERROR', e?.message || e);
    res.redirect('tallyup://square-callback?error=server_error');
  }
});

// POST /square/oauth-callback-post — legacy fallback: client exchanges code directly.
app.post("/square/oauth-callback-post", async (req, res) => {
  try {
    if (!squareIsActivated()) {
      res.json({ ok: false, error: "Square integration not yet activated" });
      return;
    }
    const { code, state, code_verifier } = req.body || {};
    if (!code || !state || !code_verifier) {
      res.status(400).json({ ok: false, error: "Missing code, state, or code_verifier" });
      return;
    }
    const venueId = String(state);

    const tokenResp = await fetch(`${SQUARE_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        grant_type: "authorization_code",
        code,
        code_verifier,
      }),
    });
    const tokenData: any = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok) {
      console.error("[api/square/oauth-callback] token exchange failed", tokenData);
      res.status(500).json({ ok: false, error: tokenData?.message || "Token exchange failed" });
      return;
    }

    const accessToken = tokenData.access_token;
    const expiresAt = tokenData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const locResp = await fetch(`${SQUARE_API_BASE}/v2/locations`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION },
    });
    const locData: any = await locResp.json().catch(() => ({}));
    if (!locResp.ok) {
      console.error("[api/square/oauth-callback] locations fetch failed", locData);
      res.status(500).json({ ok: false, error: "Could not fetch Square location" });
      return;
    }
    const locationId = locData?.locations?.[0]?.id || null;

    await storeSquareTokens(venueId, {
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      merchantId: tokenData.merchant_id || null,
      locationId,
      connectedAt: new Date().toISOString(),
    });

    // Client-visible connection status — no tokens stored here.
    await admin.firestore().doc(`venues/${venueId}/posIntegration/config`).set({
      adapter: "square",
      connectedAt: new Date().toISOString(),
      locationId,
      merchantId: tokenData.merchant_id || null,
    }, { merge: true });

    console.log("[api/square/oauth-callback] OK", { venueId, locationId });
    res.json({ ok: true, locationId });
  } catch (e: any) {
    console.error("[api/square/oauth-callback] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Callback failed" });
  }
});

// POST /square/catalog-items — fetches and maps Square's catalog to POSSaleItem[].
app.post("/square/catalog-items", async (req, res) => {
  try {
    if (!squareIsActivated()) {
      res.json({ ok: false, error: "Square integration not yet activated" });
      return;
    }
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId } = req.body || {};
    if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
    await verifyVenueMembership(uid, venueId);

    const accessToken = await getValidSquareAccessToken(venueId, 0);
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "Square not connected for this venue" });
      return;
    }

    const objects = await fetchAllSquareCatalogObjects(accessToken);
    const items = mapSquareCatalogToSaleItems(objects);

    console.log("[api/square/catalog-items] OK", { venueId, itemsCount: items.length });
    res.json({ ok: true, items });
  } catch (e: any) {
    console.error("[api/square/catalog-items] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Catalog fetch failed" });
  }
});

// POST /square/disconnect — revokes the token (non-fatal if it fails) and
// deletes both the server-side tokens and the client-visible status doc.
app.post("/square/disconnect", async (req, res) => {
  try {
    if (!squareIsActivated()) {
      res.json({ ok: false, error: "Square integration not yet activated" });
      return;
    }
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId } = req.body || {};
    if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
    await verifyVenueMembership(uid, venueId);

    const tokens = await getSquareTokens(venueId);
    if (tokens?.accessToken) {
      try {
        await fetch(`${SQUARE_API_BASE}/oauth2/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
          body: JSON.stringify({ client_id: SQUARE_APP_ID, access_token: tokens.accessToken }),
        });
      } catch (e: any) {
        console.log("[api/square/disconnect] revoke error (non-fatal)", e?.message);
      }
    }

    const db = admin.firestore();
    await db.doc(`venues/${venueId}/integrationTokens/square`).delete();
    await db.doc(`venues/${venueId}/posIntegration/config`).delete();

    console.log("[api/square/disconnect] OK", { venueId });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/square/disconnect] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Disconnect failed" });
  }
});

// ── GET /square/sandbox-test ──────────────────────────────────────────────────
// Tests the sandbox access token by pulling catalogue items
// Remove before production
app.get("/square/sandbox-test", async (req, res) => {
  try {
    if (!SQUARE_SANDBOX_TOKEN) {
      res.status(400).json({ ok: false, error: 'SQUARE_SANDBOX_ACCESS_TOKEN not set' });
      return;
    }

    // Test 1: Get merchant info
    const merchantResp = await fetch(`${SQUARE_API_BASE_RESOLVED}/v2/merchants/me`, {
      headers: {
        'Authorization': `Bearer ${SQUARE_SANDBOX_TOKEN}`,
        'Square-Version': SQUARE_VERSION,
      },
    });
    const merchantData: any = await merchantResp.json().catch(() => ({}));

    // Test 2: Get catalogue items
    const catalogResp = await fetch(`${SQUARE_API_BASE_RESOLVED}/v2/catalog/list?types=ITEM`, {
      headers: {
        'Authorization': `Bearer ${SQUARE_SANDBOX_TOKEN}`,
        'Square-Version': SQUARE_VERSION,
      },
    });
    const catalogData: any = await catalogResp.json().catch(() => ({}));
    const items = (catalogData.objects || [])
      .filter((o: any) => o.type === 'ITEM')
      .map((o: any) => ({
        id: o.id,
        name: o.item_data?.name,
        price: o.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount,
      }));

    // Test 3: Get locations
    const locResp = await fetch(`${SQUARE_API_BASE_RESOLVED}/v2/locations`, {
      headers: {
        'Authorization': `Bearer ${SQUARE_SANDBOX_TOKEN}`,
        'Square-Version': SQUARE_VERSION,
      },
    });
    const locData: any = await locResp.json().catch(() => ({}));
    const locations = (locData.locations || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status,
    }));

    res.json({
      ok: true,
      merchant: {
        id: merchantData.merchant?.id,
        businessName: merchantData.merchant?.business_name,
        country: merchantData.merchant?.country,
        currency: merchantData.merchant?.currency,
      },
      locations,
      catalogItemCount: items.length,
      catalogItems: items.slice(0, 10),
    })
  } catch (e: any) {
    console.error('[square/sandbox-test]', e?.message)
    res.status(500).json({ ok: false, error: e?.message })
  }
})

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Account deletion: financial records archive ─────────────────────────────

async function hasXeroConnected(
  db: admin.firestore.Firestore,
  venueId: string
): Promise<boolean> {
  try {
    const xeroSnap = await db
      .doc(`venues/${venueId}/integrations/xero`)
      .get();

    const data = xeroSnap.data();

    // Xero is considered connected if:
    // 1. Doc exists
    // 2. connected === true
    // 3. lastSyncAt exists (has actually synced)
    return (
      xeroSnap.exists
      && data?.connected === true
      && !!data?.lastSyncAt
    );
  } catch (e) {
    // If we can't check — assume no Xero
    // Don't block deletion on this
    console.warn(
      '[xero-check] could not check:',
      (e as any)?.message
    );
    return false;
  }
}

async function generateFinancialCSV(
  db: admin.firestore.Firestore,
  venueId: string,
  venueName: string
): Promise<{
  csv: string;
  summary: {
    invoiceCount: number;
    orderCount: number;
    priceHistoryCount: number;
    dateRange: string;
  };
}> {
  const lines: string[] = [];

  // ── INVOICES ──
  lines.push('=== INVOICES ===');
  lines.push(
    'Date,Supplier,Invoice Number,'
    + 'Total (incl GST),Lines'
  );

  const invoicesSnap = await db
    .collection(
      `venues/${venueId}/invoices`
    )
    .orderBy('invoiceDate', 'desc')
    .get()
    .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

  const dates: string[] = [];

  for (const doc of invoicesSnap.docs) {
    const d = doc.data();
    const lineItems = (d.lines || [])
      .map((l: any) =>
        `${l.name || ''} x${l.qty || 0}`
        + ` @ $${l.unitPrice || 0}`
      ).join(' | ');

    if (d.invoiceDate) {
      dates.push(d.invoiceDate);
    }

    lines.push(
      `"${d.invoiceDate || ''}",`
      + `"${d.supplierName || ''}",`
      + `"${d.invoiceNumber || ''}",`
      + `"${d.totalAmount || 0}",`
      + `"${lineItems}"`
    );
  }

  lines.push('');

  // ── PURCHASE ORDERS ──
  lines.push('=== PURCHASE ORDERS ===');
  lines.push(
    'Date,Supplier,Status,'
    + 'Total Value,Products'
  );

  const ordersSnap = await db
    .collection(
      `venues/${venueId}/orders`
    )
    .orderBy('createdAt', 'desc')
    .get()
    .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

  for (const doc of ordersSnap.docs) {
    const d = doc.data();
    const products = (d.products || [])
      .map((p: any) =>
        `${p.name || ''} x${p.qty || 0}`
      ).join(' | ');

    const dateStr = d.createdAt
      ?.toDate?.()
      ?.toISOString()
      ?.split('T')[0] || '';

    lines.push(
      `"${dateStr}",`
      + `"${d.supplierName || ''}",`
      + `"${d.status || ''}",`
      + `"${d.totalValue || 0}",`
      + `"${products}"`
    );
  }

  lines.push('');

  // ── PRICE HISTORY ──
  lines.push('=== PRICE HISTORY ===');
  lines.push(
    'Product,Old Price,New Price,'
    + 'Change %,Date,Supplier'
  );

  const productsSnap = await db
    .collection(
      `venues/${venueId}/products`
    )
    .get()
    .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

  let priceHistoryCount = 0;

  for (const productDoc of
      productsSnap.docs.slice(0, 100)) {
    const historySnap = await db
      .collection(
        `venues/${venueId}/products/`
        + `${productDoc.id}/priceHistory`
      )
      .orderBy('date', 'desc')
      .limit(20)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

    for (const h of historySnap.docs) {
      const hd = h.data();
      priceHistoryCount++;
      lines.push(
        `"${productDoc.data().name || ''}",`
        + `"${hd.oldPrice || ''}",`
        + `"${hd.newPrice || ''}",`
        + `"${hd.changePercent || ''}",`
        + `"${hd.date?.toDate?.()
            ?.toISOString()
            ?.split('T')[0] || ''}",`
        + `"${hd.supplierName || ''}"`
      );
    }
  }

  lines.push('');
  lines.push(
    `=== GENERATED: ${
      new Date().toISOString()
    } ===`
  );
  lines.push(
    `=== VENUE: ${venueName} ===`
  );
  lines.push(
    '=== RETAIN FOR 7 YEARS '
    + '(NZ Tax Administration Act 1994) ==='
  );

  const sortedDates = [...dates].sort();
  const dateRange = dates.length > 0
    ? `${sortedDates[0]} to `
      + `${sortedDates[
          sortedDates.length - 1
        ]}`
    : 'No dated records';

  return {
    csv: lines.join('\n'),
    summary: {
      invoiceCount: invoicesSnap.docs.length,
      orderCount: ordersSnap.docs.length,
      priceHistoryCount,
      dateRange
    }
  };
}

function buildCSVArchiveEmail(
  venueName: string,
  summary: {
    invoiceCount: number;
    orderCount: number;
    priceHistoryCount: number;
    dateRange: string;
  }
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif;
    max-width: 600px; margin: 0 auto;
    padding: 40px 20px;
    background: #f5f3ee; }
  .card { background: white;
    border-radius: 12px; padding: 28px;
    margin-bottom: 20px; }
  h1 { color: #0B132B; font-size: 22px;
    margin-bottom: 8px; }
  p { color: #6b7280; line-height: 1.6;
    margin: 0 0 12px; }
  .stat { display: inline-block;
    background: #f5f3ee;
    border-radius: 8px;
    padding: 10px 16px;
    margin: 6px 6px 6px 0; }
  .stat-value { font-size: 22px;
    font-weight: bold; color: #0B132B; }
  .stat-label { font-size: 12px;
    color: #6b7280; }
  .notice { background: #fef9ec;
    border-left: 4px solid #c47b2b;
    padding: 14px 16px;
    border-radius: 4px; margin: 20px 0; }
  .notice p { color: #3b3f4a;
    margin: 0; font-size: 14px; }
  .footer { color: #9ca3af;
    font-size: 12px; text-align: center;
    margin-top: 28px; }
</style>
</head>
<body>
<div class="card">
  <h1>Your Hosti financial records</h1>
  <p>We're sorry to see you go.
  Your complete financial records for
  <strong>${venueName}</strong> are
  attached to this email.</p>
  <p>As required by NZ law
  (Tax Administration Act 1994)
  please keep this file for 7 years.</p>

  <div class="stat">
    <div class="stat-value">
      ${summary.invoiceCount}
    </div>
    <div class="stat-label">Invoices</div>
  </div>
  <div class="stat">
    <div class="stat-value">
      ${summary.orderCount}
    </div>
    <div class="stat-label">
      Purchase orders
    </div>
  </div>
  <div class="stat">
    <div class="stat-value">
      ${summary.priceHistoryCount}
    </div>
    <div class="stat-label">
      Price records
    </div>
  </div>

  <p style="margin-top:16px">
    <strong>Date range:</strong>
    ${summary.dateRange}
  </p>
</div>

<div class="notice">
  <p>⚠️ <strong>Please save this file.
  </strong> IRD requires financial records
  to be kept for 7 years. Save it to
  Google Drive, Dropbox, or send it
  to your accountant.</p>
</div>

<div class="card">
  <p><strong>Your data has been
  permanently deleted from Hosti.
  </strong> We hold no copies.</p>
  <p>Questions?
  <a href="mailto:hello@hosti.co.nz">
  hello@hosti.co.nz</a></p>
</div>

<div class="footer">
  <p>Hosti — hosti.co.nz</p>
</div>
</body>
</html>`;
}

function buildXeroArchiveEmail(
  venueName: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif;
    max-width: 600px; margin: 0 auto;
    padding: 40px 20px;
    background: #f5f3ee; }
  .card { background: white;
    border-radius: 12px; padding: 28px;
    margin-bottom: 20px; }
  h1 { color: #0B132B; font-size: 22px;
    margin-bottom: 8px; }
  p { color: #6b7280; line-height: 1.6;
    margin: 0 0 12px; }
  .xero { background: #e8f5e9;
    border-left: 4px solid #2e7d32;
    padding: 14px 16px;
    border-radius: 4px; margin: 20px 0; }
  .xero p { color: #1b5e20; margin: 0;
    font-size: 14px; }
  .footer { color: #9ca3af;
    font-size: 12px; text-align: center;
    margin-top: 28px; }
</style>
</head>
<body>
<div class="card">
  <h1>Your Hosti account summary</h1>
  <p>We're sorry to see you go.</p>
  <p>Your venue <strong>${venueName}
  </strong> was connected to Xero.
  Your complete financial records are
  already in your Xero account —
  invoices, purchase orders, and
  price history have been synced.</p>
</div>

<div class="xero">
  <p>✓ <strong>Your records are in Xero.
  </strong> Log into your Xero account
  to access your complete financial
  history. IRD accepts Xero as the
  record of truth for NZ businesses.
  </p>
</div>

<div class="card">
  <p><strong>Your Hosti data has been
  permanently deleted.</strong>
  We hold no copies.</p>
  <p>Questions?
  <a href="mailto:hello@hosti.co.nz">
  hello@hosti.co.nz</a></p>
</div>

<div class="footer">
  <p>Hosti — hosti.co.nz</p>
</div>
</body>
</html>`;
}

async function sendArchiveEmail(
  ownerEmail: string,
  venueName: string,
  hasXero: boolean,
  csvContent?: string,
  summary?: {
    invoiceCount: number;
    orderCount: number;
    priceHistoryCount: number;
    dateRange: string;
  }
): Promise<{
  sent: boolean;
  error?: string;
}> {
  const apiKey =
    process.env.POSTMARK_API_KEY;
  if (!apiKey) {
    return {
      sent: false,
      error: 'POSTMARK_API_KEY not set'
    };
  }

  const venueSafe = venueName
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

  const dateStr = new Date()
    .toISOString()
    .split('T')[0];

  const subject = hasXero
    ? `Your Hosti records summary`
      + ` — ${venueName}`
    : `Your Hosti financial records`
      + ` — ${venueName}`;

  const htmlBody = hasXero
    ? buildXeroArchiveEmail(venueName)
    : buildCSVArchiveEmail(
        venueName, summary!
      );

  const body: any = {
    From: 'Hosti <records@hosti.co.nz>',
    To: ownerEmail,
    Subject: subject,
    HtmlBody: htmlBody,
    MessageStream: 'outbound'
  };

  // Attach CSV if no Xero
  if (!hasXero && csvContent) {
    const csvBase64 = Buffer.from(
      csvContent, 'utf-8'
    ).toString('base64');

    body.Attachments = [{
      Name: `hosti-financial-records-`
        + `${venueSafe}-${dateStr}.csv`,
      Content: csvBase64,
      ContentType: 'text/csv'
    }];
  }

  try {
    const response = await fetch(
      'https://api.postmarkapp.com/email',
      {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const err = await response.json()
        .catch(() => ({}));
      console.error(
        '[archive-email] Postmark error:',
        err
      );
      return {
        sent: false,
        error: `Postmark ${response.status}`
      };
    }

    console.log(
      `[archive-email] sent to`
      + ` ${ownerEmail} for ${venueName}`
      + ` (xero: ${hasXero})`
    );
    return { sent: true };

  } catch (e: any) {
    console.error(
      '[archive-email] fetch failed:',
      e?.message
    );
    return {
      sent: false,
      error: e?.message
    };
  }
}

// ── DELETE /account ───────────────────────────────────────────────────────────
// Deletes all venue data if user is owner, removes from member lists,
// deletes user Firestore doc, and removes the Firebase Auth account.
app.delete("/account", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const db = admin.firestore();

    // Resolve all venues for this user (supports multi-venue)
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? (userSnap.data() as any) : null;
    const legacyVenueId: string | null = userData?.venueId ?? null;
    const allVenueIds: string[] = userData?.venueIds ?? (legacyVenueId ? [legacyVenueId] : []);

    for (const venueId of allVenueIds) {
      try {
        const venueSnap = await db.doc(`venues/${venueId}`).get();
        const ownerUid: string | null = venueSnap.exists ? (venueSnap.data() as any)?.ownerUid ?? null : null;

        if (ownerUid === uid) {
          // Write archive marker before deleting venue data
          await db.collection('deletedVenues').doc(venueId).set({
            venueId,
            venueName: venueSnap.data()?.name || 'Unknown venue',
            ownerUid: uid,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            retainUntil: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000),
            archiveStatus: 'marker_only',
            note: 'Full archive generation pending implementation',
          });

          // Send financial records archive email before deleting venue data
          try {
            const userRecord = await admin.auth().getUser(uid);
            const ownerEmail = userRecord.email;

            if (!ownerEmail) {
              // No email on account
              // Skip archive — can't send
              console.warn(
                '[account] no email for uid:',
                uid
              );
            } else {
              // Check Xero connection
              const xeroConnected =
                await hasXeroConnected(
                  db, venueId
                );

              let sent = false;

              if (xeroConnected) {
                // Scenario 1 — Xero path
                // Send lightweight summary only
                const result = await sendArchiveEmail(
                  ownerEmail,
                  venueSnap.data()?.name
                    || 'Your venue',
                  true // hasXero
                );
                sent = result.sent;

                if (!sent) {
                  console.error(
                    '[account] Xero summary'
                    + ' email failed:',
                    result.error
                  );
                }

              } else {
                // Scenario 2 — No Xero
                // Generate CSV and send
                const { csv, summary } =
                  await generateFinancialCSV(
                    db,
                    venueId,
                    venueSnap.data()?.name
                      || 'Your venue'
                  );

                const result = await sendArchiveEmail(
                  ownerEmail,
                  venueSnap.data()?.name
                    || 'Your venue',
                  false, // hasXero
                  csv,
                  summary
                );
                sent = result.sent;

                if (!sent) {
                  console.error(
                    '[account] CSV archive'
                    + ' email failed:',
                    result.error
                  );
                  // NOTE: We log but do NOT
                  // block deletion on email failure.
                  // Better to delete than to trap
                  // the user in a failed state.
                  // Email failure is logged for
                  // manual follow-up if needed.
                }
              }

              // Write deletion log
              // Metadata only — no financial data
              await db.collection('deletionLog')
                .add({
                  venueId,
                  venueName:
                    venueSnap.data()?.name
                    || 'Unknown',
                  ownerUid: uid,
                  ownerEmail: ownerEmail
                    .replace(
                      /(.{2})(.*)(@.*)/,
                      '$1***$3'
                    ), // masked
                  deletedAt:
                    admin.firestore
                      .FieldValue.serverTimestamp(),
                  archiveMethod: xeroConnected
                    ? 'xero_summary'
                    : 'csv_attachment',
                  archiveEmailSent: sent,
                  // No financial data stored
                  // in log — metadata only
                });
            }
          } catch (archiveErr: any) {
            // Archive failed — log and continue
            // Never block deletion for archive failure
            console.error(
              '[account] archive step failed:',
              archiveErr?.message
            );
          }

          // Owner — delete everything under this venue
          await deleteVenueAllData(db, venueId);
        } else {
          // Member — remove from members subcollection only
          await db.doc(`venues/${venueId}/members/${uid}`).delete().catch(() => {});
        }
      } catch (e: any) {
        console.error(`[api/account] failed to delete venue ${venueId}:`, e?.message);
        // Log and continue — do not abort entire deletion for one venue failure
      }
    }

    // Delete user Firestore doc
    await db.doc(`users/${uid}`).delete().catch(() => {});

    // Delete Firebase Auth account
    await admin.auth().deleteUser(uid);

    console.log("[api/account] DELETE OK", { uid, venueIds: allVenueIds });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/account] DELETE ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Account deletion failed" });
  }
});

// ── POST /deleteVenue ──────────────────────────────────────────────────────────
// Soft-deletes a venue: owner-only. Actual data removal happens 48h later via
// the scheduledHardDelete Cloud Function, giving a recovery window via /restoreVenue.
app.post("/deleteVenue", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId } = req.body || {};
    if (!venueId) { res.status(400).json({ ok: false, error: "venueId required" }); return; }

    const db = admin.firestore();

    // Confirm caller is owner of this venue
    const memberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    if (!memberSnap.exists || (memberSnap.data() as any)?.role !== "owner") {
      res.status(403).json({ ok: false, error: "Only the venue owner can delete a project" });
      return;
    }

    const scheduledHardDeleteAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await db.doc(`venues/${venueId}`).update({
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: uid,
      scheduledHardDeleteAt,
    });

    console.log(`[api/deleteVenue] soft-deleted venueId=${venueId} uid=${uid}`);
    res.json({ ok: true, softDeleted: true, recoverableUntil: scheduledHardDeleteAt });
  } catch (e: any) {
    console.error("[api/deleteVenue] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Delete failed" });
  }
});

// ── POST /restoreVenue ──────────────────────────────────────────────────────────
// Restores a venue that's still within its 48-hour soft-delete recovery window.
// Owner-only — same auth pattern as /deleteVenue.
app.post("/restoreVenue", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId } = req.body || {};
    if (!venueId) { res.status(400).json({ ok: false, error: "venueId required" }); return; }

    const db = admin.firestore();

    const memberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    if (!memberSnap.exists || (memberSnap.data() as any)?.role !== "owner") {
      res.status(403).json({ ok: false, error: "Only the venue owner can restore a project" });
      return;
    }

    const venueRef = db.doc(`venues/${venueId}`);
    const venueSnap = await venueRef.get();
    if (!venueSnap.exists) { res.status(404).json({ ok: false, error: "Venue not found" }); return; }

    const data = venueSnap.data() as any;
    const scheduledHardDeleteAt: admin.firestore.Timestamp | null = data?.scheduledHardDeleteAt ?? null;
    const isRecoverable = !!data?.deletedAt && !!scheduledHardDeleteAt && scheduledHardDeleteAt.toMillis() > Date.now();
    if (!isRecoverable) {
      res.status(400).json({ ok: false, error: "This project is no longer recoverable" });
      return;
    }

    await venueRef.update({
      deletedAt: admin.firestore.FieldValue.delete(),
      deletedBy: admin.firestore.FieldValue.delete(),
      scheduledHardDeleteAt: admin.firestore.FieldValue.delete(),
    });

    console.log(`[api/restoreVenue] OK venueId=${venueId} uid=${uid}`);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/restoreVenue] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Restore failed" });
  }
});

export async function deleteVenueAllData(db: admin.firestore.Firestore, venueId: string): Promise<void> {
  // Departments → areas → items (recursive structure)
  const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
  for (const dept of deptsSnap.docs) {
    const areasSnap = await db.collection(`venues/${venueId}/departments/${dept.id}/areas`).get();
    for (const area of areasSnap.docs) {
      await deleteDocs(db, `venues/${venueId}/departments/${dept.id}/areas/${area.id}/items`);
      await area.ref.delete();
    }
    await deleteDocs(db, `venues/${venueId}/departments/${dept.id}/reports`);
    await dept.ref.delete();
  }

  // All other top-level venue subcollections
  const topCols = [
    "members", "products", "orders", "suppliers", "invoices", "budgets",
    "salesReports", "salesReportMatches", "salesReportUnknowns", "slowMovers",
    "processedInvoices", "processedSalesReports", "processedStocktakes", "aiUsage",
    "importJobs", "orderLocks", "orderCounters", "counters_orders",
    "reconciliations", "fastReceives", "deliveries", "shelfScanJobs", "ocrJobs",
    "stockTakes", "sessions", "reports", "computed", "areas", "items",
    "recipes", "aiContext", "photoCountCorrections", "recipeSalesAttribution",
    "productNotes", "invites",
    "bars", "sourceLocations", "transfers", "requests", "contracts", "riders",
    "consumables", "returns", "eventHistory", "activations", "obligations",
    "predictions", "planograms",
  ];
  for (const col of topCols) {
    await deleteDocs(db, `venues/${venueId}/${col}`);
  }

  await deleteSubcollection(`venues/${venueId}/departments`, 'snapshots');
  await deleteSubcollection(`venues/${venueId}/products`, 'priceHistory');
  await deleteSubcollection(`venues/${venueId}/products`, 'suppliers');
  await deleteSubcollection(`venues/${venueId}/bars`, 'stock');

  // Delete all settings docs
  const settingsSnap = await db.collection(`venues/${venueId}/settings`).get();
  const settingsBatch = db.batch();
  settingsSnap.docs.forEach(d => settingsBatch.delete(d.ref));
  if (settingsSnap.docs.length > 0) {
    await settingsBatch.commit();
  }
  await admin.firestore().doc(`venues/${venueId}/event/details`).delete().catch(() => {});

  await db.doc(`venues/${venueId}`).delete();
}

async function deleteDocs(db: admin.firestore.Firestore, colPath: string): Promise<void> {
  const snap = await db.collection(colPath).limit(200).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  if (snap.docs.length >= 200) await deleteDocs(db, colPath);
}

async function deleteSubcollection(parentPath: string, subcollectionName: string): Promise<void> {
  const parentSnap = await admin.firestore().collection(parentPath).get();
  const deletes = parentSnap.docs.map(doc =>
    admin.firestore()
      .collection(`${doc.ref.path}/${subcollectionName}`)
      .get()
      .then(sub => Promise.all(sub.docs.map(d => d.ref.delete())))
  );
  await Promise.all(deletes);
}

// ── POST /suitee ──────────────────────────────────────────────────────────────
app.post("/suitee", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { question, venueId, history } = req.body || {};
    if (!question || typeof question !== "string") {
      res.status(400).json({ ok: false, error: "Missing question" }); return;
    }
    if (!venueId || typeof venueId !== "string") {
      res.status(400).json({ ok: false, error: "Missing venueId" }); return;
    }
    await verifyVenueMembership(uid, venueId);
    const lcSU = await checkAiLimit(venueId, 'suitee');
    if (!lcSU.allowed) { res.status(429).json(lcSU.limitError); return; }

    const db = admin.firestore();

    // ── Festival routing ──────────────────────────────────────────────────────
    try {
      const venueDoc = await db.doc(`venues/${venueId}`).get();
      if (venueDoc.exists && venueDoc.data()?.venueType === 'festival') {
        const festAnswer = await handleFestivalSuitee(venueId, question, uid!, db, history);
        const meter = await trackAiCall(venueId, 'suitee');
        res.json({ ok: true, answer: festAnswer, usageWarning: meter.usageWarning ?? null });
        return;
      }
    } catch {}

    // ── Gather venue context (parallelised — departments fetched once) ──────────

    const ninetyDaysTs = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    );

    // STEP 1: All top-level collections in one parallel batch
    const [
      productsSnap,
      suppliersSnap,
      deptsSnap,
      ordersSnap,
      salesSnap,
      slowMoversSnap,
      priceChangedSnap,
      invoicesSnap,
      budgetsSnap,
      wastageSnap,
      recipesSnap,
    ] = await Promise.all([
      db.collection(`venues/${venueId}/products`).limit(200).get().catch(() => null),
      db.collection(`venues/${venueId}/suppliers`).get().catch(() => null),
      db.collection(`venues/${venueId}/departments`).get().catch(() => null),
      // Orders with orderBy so most recent are returned (was unordered — bug fix)
      db.collection(`venues/${venueId}/orders`).orderBy('createdAt', 'desc').limit(10).get()
        .catch(() => db.collection(`venues/${venueId}/orders`).limit(10).get().catch(() => null)),
      db.collection(`venues/${venueId}/salesReports`).orderBy('createdAt', 'desc').limit(3).get()
        .catch(() => db.collection(`venues/${venueId}/salesReports`).limit(3).get().catch(() => null)),
      db.collection(`venues/${venueId}/slowMovers`).limit(20).get().catch(() => null),
      db.collection(`venues/${venueId}/products`).where('priceChanged', '==', true).limit(10).get().catch(() => null),
      db.collection(`venues/${venueId}/invoices`).where('invoiceDateTimestamp', '>=', ninetyDaysTs).limit(200).get().catch(() => null),
      db.collection(`venues/${venueId}/budgets`).get().catch(() => null),
      db.collection(`venues/${venueId}/wastage`).where('createdAt', '>=', ninetyDaysTs).limit(50).get()
        .catch(() => db.collection(`venues/${venueId}/wastage`).limit(50).get().catch(() => null)),
      db.collection(`venues/${venueId}/recipes`).where('status', '==', 'confirmed').limit(20).get().catch(() => null),
    ]);

    // Process products
    let products: any[] = [];
    if (productsSnap) {
      products = productsSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || d.id,
          costPrice: typeof data.costPrice === "number" ? data.costPrice : null,
          parLevel: typeof data.parLevel === "number" ? data.parLevel : null,
          lastCountAt: data.lastCountAt?.toDate?.()?.toISOString() || null,
        };
      });
    }

    // Process suppliers — full contact details (FIX 4)
    const supplierContactLines: string[] = [];
    const supplierNameById = new Map<string, string>();
    if (suppliersSnap) {
      suppliersSnap.docs.forEach(d => {
        const s = d.data() as any;
        supplierNameById.set(d.id, s.name || d.id);
      });
      suppliersSnap.docs
        .filter(d => !(d.data() as any).isHoldingSupplier)
        .forEach(d => {
          const s = d.data() as any;
          const parts: string[] = [s.name || d.id];
          if (s.email) parts.push(`email: ${s.email}`);
          if (s.phone) parts.push(`phone: ${s.phone}`);
          if (s.accountNumber) parts.push(`account: ${s.accountNumber}`);
          if (s.defaultLeadDays) parts.push(`lead: ${s.defaultLeadDays}d`);
          supplierContactLines.push(`  ${parts.join(' | ')}`);
        });
    }

    // Per-product supplier intelligence (top 20 by value, parallelised)
    const productSupplierLines: string[] = [];
    try {
      const topByValue = [...products]
        .filter(p => p.costPrice != null)
        .sort((a, b) => (b.costPrice || 0) - (a.costPrice || 0))
        .slice(0, 20);
      const supplierLinkResults = await Promise.all(
        topByValue.map(async p => {
          try {
            const linksSnap = await db.collection(`venues/${venueId}/products/${p.id}/suppliers`).limit(10).get();
            return { p, linksSnap };
          } catch { return null; }
        })
      );
      for (const result of supplierLinkResults) {
        if (!result || result.linksSnap.empty) continue;
        const { p, linksSnap } = result;
        const links = linksSnap.docs.map(d => d.data() as any);
        const preferred = links.find(l => l.isPreferred);
        const cheapest = links.reduce((a: any, b: any) => ((a.unitCost || 999) <= (b.unitCost || 999) ? a : b));
        const parts = links.map((l: any) => {
          const tag = l.isPreferred ? '⭐' : '';
          const cost = l.unitCost != null ? `$${Number(l.unitCost).toFixed(2)}/unit` : 'no price';
          return `${tag}${l.supplierName}(${l.relationship},${cost})`;
        });
        const cheaperNote = preferred && cheapest && preferred.supplierId !== cheapest.supplierId && preferred.unitCost && cheapest.unitCost
          ? ` [cheaper alt: ${cheapest.supplierName} $${Number(cheapest.unitCost).toFixed(2)}]`
          : '';
        productSupplierLines.push(`${p.name}: ${parts.join(' | ')}${cheaperNote}`);
      }
    } catch {}

    // STEP 2: Single parallel per-department traversal — replaces the previous 3 sequential
    // passes over departments (variance, snapshots, velocity). Each department now fetches
    // areas+items and snapshots in parallel.
    const allShortages: { name: string; varianceUnits: number; dollarVariance: number; deptName: string; areaName: string }[] = [];
    const allExcesses: { name: string; varianceUnits: number; dollarVariance: number; deptName: string; areaName: string }[] = [];
    const trendItems: { name: string; deptName: string }[] = [];
    let totalItemsCounted = 0;
    let shortfallDollars = 0;
    let excessDollars = 0;
    let stockHoldingValue = 0;
    let hasCountData = false;
    let hasPrevCycle = false;
    const deptContextLines: string[] = [];
    const snapshotContextLines: string[] = [];
    const productCycles = new Map<string, { productId: string | null; velocities: number[]; lastStock: number; costPrice: number | null; parLevel: number | null }>();

    if (deptsSnap) {
      const deptResults = await Promise.all(deptsSnap.docs.map(async deptDoc => {
        try {
          const [areasSnap, snapshotsSnap] = await Promise.all([
            db.collection(`venues/${venueId}/departments/${deptDoc.id}/areas`).get(),
            db.collection(`venues/${venueId}/departments/${deptDoc.id}/snapshots`)
              .orderBy('completedAt', 'desc').limit(6).get(),
          ]);
          const itemsByArea = await Promise.all(
            areasSnap.docs.map(async areaDoc => ({
              areaDoc,
              itemsSnap: await db.collection(`venues/${venueId}/departments/${deptDoc.id}/areas/${areaDoc.id}/items`).get(),
            }))
          );
          return { deptDoc, areasSnap, snapshotsSnap, itemsByArea };
        } catch (e: any) {
          console.log("[api/suitee] dept traversal error", deptDoc.id, e?.message);
          return null;
        }
      }));

      for (const result of deptResults) {
        if (!result) continue;
        const { deptDoc, snapshotsSnap, itemsByArea } = result;
        const deptData = deptDoc.data();
        const deptName: string = (deptData.name as string) || deptDoc.id;
        const totalCycles: number = typeof deptData.totalCyclesCompleted === "number" ? deptData.totalCyclesCompleted : 0;
        const lastCycleStr: string | null = deptData.lastCycleAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || null;

        // Variance + stock holding from area items
        let deptAreasTotal = 0, deptAreasCompleted = 0, deptActive = false;
        for (const { areaDoc, itemsSnap } of itemsByArea) {
          deptAreasTotal++;
          const aData = areaDoc.data();
          if (aData.completedAt) deptAreasCompleted++;
          else if (aData.startedAt) deptActive = true;
          const areaName: string = (aData.name as string) || areaDoc.id;

          for (const itemDoc of itemsSnap.docs) {
            const d = itemDoc.data();
            const lastCount = typeof d.lastCount === "number" ? d.lastCount : null;
            const confirmedCount = typeof d.confirmedCount === "number" ? d.confirmedCount : null;
            const parLevel = typeof d.parLevel === "number" ? d.parLevel : null;
            const costPrice = typeof d.costPrice === "number" ? d.costPrice : null;
            const name: string = (d.name as string) || itemDoc.id;

            const holdingCount = lastCount ?? confirmedCount ?? 0;
            if (costPrice) stockHoldingValue += holdingCount * costPrice;

            if ((lastCount != null && lastCount > 0) || (confirmedCount != null && confirmedCount > 0)) hasCountData = true;
            if (confirmedCount != null && confirmedCount > 0) hasPrevCycle = true;

            const lastCountAtMs: number | null = d.lastCountAt?.toMillis?.() ?? d.lastCountAt?.toDate?.()?.getTime?.() ?? null;
            const confirmedCountAtMs: number | null = d.confirmedCountAt?.toMillis?.() ?? d.confirmedCountAt?.toDate?.()?.getTime?.() ?? null;
            const countedInCycle = lastCountAtMs != null && (confirmedCountAtMs == null || lastCountAtMs > confirmedCountAtMs);
            if (!countedInCycle || lastCount == null) continue;

            totalItemsCounted++;
            const baseline: number | null = confirmedCount ?? parLevel ?? null;
            if (baseline == null) continue;

            const varianceUnits = lastCount - baseline;
            const dollar = costPrice != null ? Math.abs(varianceUnits) * costPrice : 0;
            if (varianceUnits < 0) {
              allShortages.push({ name, varianceUnits, dollarVariance: dollar, deptName, areaName });
              shortfallDollars += dollar;
            } else if (varianceUnits > 0) {
              allExcesses.push({ name, varianceUnits, dollarVariance: dollar, deptName, areaName });
              excessDollars += dollar;
            }
            if (confirmedCount != null && parLevel != null && confirmedCount < parLevel && lastCount < parLevel) {
              trendItems.push({ name, deptName });
            }
          }
        }

        const activeFlag = deptActive ? " (in progress)" : deptAreasCompleted === deptAreasTotal && deptAreasTotal > 0 ? " (complete)" : "";
        deptContextLines.push(`  ${deptName}: ${totalCycles} cycle${totalCycles !== 1 ? "s" : ""} completed, last ${lastCycleStr ?? "never"}, areas ${deptAreasCompleted}/${deptAreasTotal}${activeFlag}`);

        // Snapshot context + velocity from the same snapshotsSnap (no second fetch)
        if (!snapshotsSnap.empty) {
          const snapDocs = snapshotsSnap.docs.map(d => d.data() as any);
          const latest = snapDocs[0];
          const s = latest.summary || {};
          const dc = latest.dataCompleteness || {};
          const deptSnapLines = [
            `  ${latest.departmentName || deptName}: ${snapDocs.length} cycle(s) on record, Tier ${dc.tier ?? 1}/4`,
            `    Latest (Cycle ${latest.cycleNumber}): Items ${s.totalItemsCounted}, below PAR: ${s.itemsBelowPAR}, variance qty: ${s.totalVarianceQty}`,
            s.totalVarianceDollars != null ? `    Latest variance value: $${(s.totalVarianceDollars as number).toFixed(2)}` : '    No cost prices set',
            s.totalStockValue != null ? `    Latest stock value: $${(s.totalStockValue as number).toFixed(2)}` : null,
            dc.hasInvoices ? '    Has invoice data.' : '    No invoice data for this cycle.',
          ].filter(Boolean) as string[];
          snapshotContextLines.push(...deptSnapLines);

          const findings = latest.findings || {};
          if ((findings.likelyMissingInvoices || []).length > 0) {
            snapshotContextLines.push(`    Missing invoices: ${findings.likelyMissingInvoices.map((f: any) => `${f.productName} +${f.unexplainedGainQty}`).join(', ')}`);
          }
          if ((findings.poDiscrepancies || []).length > 0) {
            snapshotContextLines.push(`    PO shortfalls: ${findings.poDiscrepancies.map((f: any) => `${f.productName} (ordered ${f.orderedQty}, got ${f.receivedQty})`).join(', ')}`);
          }
          if (snapDocs.length > 1) {
            snapshotContextLines.push(`    CYCLE HISTORY (last ${snapDocs.length}):`);
            snapDocs.forEach((snap: any) => {
              const ss = snap.summary || {};
              const completedDateStr = snap.completedAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || "unknown";
              const completedBy = snap.completedByName ? ` by ${snap.completedByName}` : '';
              const valStr = ss.totalStockValue != null ? `, stock $${ss.totalStockValue.toFixed(0)}` : '';
              const varStr = ss.totalVarianceQty != null ? `, var qty ${ss.totalVarianceQty > 0 ? '+' : ''}${ss.totalVarianceQty}` : '';
              const varDolStr = ss.totalVarianceDollars != null ? ` ($${ss.totalVarianceDollars.toFixed(0)})` : '';
              snapshotContextLines.push(`      Cycle ${snap.cycleNumber} (${completedDateStr}${completedBy}): ${ss.totalItemsCounted ?? 0} items${valStr}${varStr}${varDolStr}`);
            });
          }

          // Velocity from snapshot items — filter v !== 0 before averaging (already correct)
          for (const snapDoc of snapshotsSnap.docs) {
            const snap = snapDoc.data() as any;
            const daysSince: number | null = snap.daysSinceLastCycle != null ? snap.daysSinceLastCycle : null;
            const cycleWeeks = daysSince != null && daysSince > 0 ? daysSince / 7 : null;
            for (const item of (snap.items || [])) {
              const key = (item.name || '').toLowerCase().trim();
              if (!key) continue;
              const openingCount = typeof item.openingCount === 'number' ? item.openingCount : null;
              const actualClosing = typeof item.actualClosing === 'number' ? item.actualClosing : 0;
              const receivedQty = typeof item.receivedQty === 'number' ? item.receivedQty : 0;
              let velocity = 0;
              if (openingCount != null && cycleWeeks != null && cycleWeeks > 0) {
                velocity = (openingCount + receivedQty - actualClosing) / cycleWeeks;
              }
              const productId: string | null = typeof item.productId === 'string' ? item.productId : null;
              const existing = productCycles.get(key);
              if (existing) {
                existing.velocities.push(velocity);
                existing.lastStock = actualClosing;
                if (!existing.productId && productId) existing.productId = productId;
              } else {
                productCycles.set(key, { productId, velocities: [velocity], lastStock: actualClosing, costPrice: typeof item.costPrice === 'number' ? item.costPrice : null, parLevel: typeof item.parLevel === 'number' ? item.parLevel : null });
              }
            }
          }
        }
      }
    }

    if (!hasCountData) {
      res.json({ ok: true, answer: "I don't have any stocktake data yet. Complete your first stocktake and I'll be able to answer questions about your venue." });
      return;
    }

    allShortages.sort((a, b) => b.dollarVariance - a.dollarVariance);
    allExcesses.sort((a, b) => b.dollarVariance - a.dollarVariance);

    // Slow movers from loaded snapshot
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const slowMovers = products
      .filter(p => !p.lastCountAt || new Date(p.lastCountAt).getTime() < thirtyDaysAgo)
      .slice(0, 10);

    // Tracked slow movers from loaded snapshot
    const trackedSlowMoverLines: string[] = [];
    if (slowMoversSnap && !slowMoversSnap.empty) {
      const smList = slowMoversSnap.docs.map(d => d.data() as any).filter((sm: any) => {
        if (!sm.dismissedUntil) return true;
        const du: Date | null = sm.dismissedUntil?.toDate?.() ?? null;
        return !du || du < new Date();
      });
      if (smList.length > 0) {
        const totalValue = smList.reduce((sum: number, sm: any) => sum + ((sm.costPrice || 0) * (sm.currentCount || 0)), 0);
        trackedSlowMoverLines.push(`SLOW MOVING STOCK (30+ days no movement): ${smList.length} lines, $${totalValue.toFixed(2)} total value`);
        smList.slice(0, 10).forEach((sm: any) => {
          trackedSlowMoverLines.push(`  - ${sm.productName}: ${sm.currentCount} on hand, ${sm.daysSinceMovement} days idle${sm.expiryRisk ? " ⚠ expiry risk" : ""}`);
        });
        const top = [...smList].sort((a: any, b: any) => b.daysSinceMovement - a.daysSinceMovement)[0];
        if (top) trackedSlowMoverLines.push(`  Slowest: ${top.productName} — ${top.daysSinceMovement} days`);
      }
    }

    // Recent orders from loaded snapshot (now orderBy createdAt desc)
    const recentOrders: { supplierName: string; status: string; totalValue: number | null; createdAt: string | null }[] = [];
    if (ordersSnap) {
      ordersSnap.docs.forEach(d => {
        const od = d.data();
        recentOrders.push({
          supplierName: (od.supplierName as string) || (od.supplierId as string) || "Unknown",
          status: (od.status as string) || "unknown",
          totalValue: typeof od.totalValue === "number" ? od.totalValue : null,
          createdAt: od.createdAt?.toDate?.()?.toISOString()?.slice(0, 10) || null,
        });
      });
    }

    // Sales data from loaded snapshot
    let salesSummary = "";
    if (salesSnap && !salesSnap.empty) {
      salesSummary = salesSnap.docs.map(d => JSON.stringify(d.data())).join("\n");
    }

    // Price change history (still N+1 for priceHistory subcollection, now parallelised)
    const priceChangeLines: string[] = [];
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      if (priceChangedSnap && !priceChangedSnap.empty) {
        const supplierIncreases: Record<string, number> = {};
        const recentChanges: { productName: string; oldPrice: number; newPrice: number; changePercent: number; direction: string; supplierName: string; date: Date | null }[] = [];

        const priceHistories = await Promise.all(
          priceChangedSnap.docs.map(async prodDoc => {
            try {
              const histSnap = await db.collection(`venues/${venueId}/products/${prodDoc.id}/priceHistory`)
                .orderBy("date", "desc").limit(3).get();
              return { prodDoc, histSnap };
            } catch { return null; }
          })
        );

        for (const r of priceHistories) {
          if (!r) continue;
          for (const h of r.histSnap.docs) {
            const hd = h.data() as any;
            const hDate: Date | null = hd.date?.toDate ? hd.date.toDate() : null;
            if (hDate && hDate >= ninetyDaysAgo) {
              recentChanges.push({
                productName: r.prodDoc.data().name || r.prodDoc.id,
                oldPrice: hd.oldPrice ?? 0, newPrice: hd.newPrice ?? 0,
                changePercent: hd.changePercent ?? 0, direction: hd.direction || "increase",
                supplierName: hd.supplierName || "Unknown", date: hDate,
              });
              if (hd.direction === "increase" && hd.supplierName) {
                supplierIncreases[hd.supplierName] = (supplierIncreases[hd.supplierName] || 0) + 1;
              }
            }
          }
        }

        if (recentChanges.length > 0) {
          const topSupplier = Object.entries(supplierIncreases).sort((a, b) => b[1] - a[1])[0];
          priceChangeLines.push(`PRICE CHANGES (last 90 days): ${recentChanges.length} detected`);
          recentChanges.slice(0, 8).forEach(c => {
            const sign = c.changePercent >= 0 ? "+" : "";
            const dateStr = c.date ? c.date.toISOString().slice(0, 10) : "–";
            priceChangeLines.push(`  - ${c.productName}: $${c.oldPrice.toFixed(2)} → $${c.newPrice.toFixed(2)} (${sign}${c.changePercent.toFixed(1)}%) from ${c.supplierName} on ${dateStr}`);
          });
          if (topSupplier) priceChangeLines.push(`  Supplier with most increases: ${topSupplier[0]} (${topSupplier[1]} increases)`);
        }
      }
    } catch (e: any) {
      console.log("[api/suitee] price change query error", e?.message);
    }

    // Pending price change flags (manager review queue)
    const pendingFlagLines: string[] = [];
    try {
      const priceChangeFlagsSnap = await db
        .collection(`venues/${venueId}/priceChangeFlags`)
        .where("status", "==", "pending")
        .orderBy("flaggedAt", "desc")
        .limit(20)
        .get()
        .catch(() => ({ docs: [] } as any));

      const priceChangeFlags = priceChangeFlagsSnap.docs.map((d: any) => ({
        product: d.data().productName,
        oldPrice: d.data().oldPrice,
        newPrice: d.data().newPrice,
        changePercent: d.data().changePercent,
        direction: d.data().direction,
        supplier: d.data().supplierName,
        flaggedAt: d.data().flaggedAt?.toDate?.()?.toISOString() || "",
      }));

      pendingFlagLines.push("PRICE CHANGES (pending manager review):");
      if (priceChangeFlags.length === 0) {
        pendingFlagLines.push("No recent price changes flagged.");
      } else {
        priceChangeFlags.forEach((f: any) => {
          pendingFlagLines.push(`${f.product}: ${f.oldPrice} → ${f.newPrice} (${f.direction} ${Math.abs(f.changePercent)}%) from ${f.supplier}`);
        });
      }
    } catch (e: any) {
      console.log("[api/suitee] price change flags query error", e?.message);
    }

    // Invoice spend from loaded snapshot
    const invoiceSpendLines: string[] = [];
    if (invoicesSnap) {
      const supplierSpend: Record<string, { name: string; totalSpend: number; invoiceCount: number; lastInvoiceDate: string }> = {};
      for (const invDoc of invoicesSnap.docs) {
        const d = invDoc.data() as any;
        const sid = d.supplierId || "unknown";
        if (!supplierSpend[sid]) supplierSpend[sid] = { name: d.supplierName || "Unknown", totalSpend: 0, invoiceCount: 0, lastInvoiceDate: "" };
        supplierSpend[sid].totalSpend += typeof d.totalAmount === "number" ? d.totalAmount : 0;
        supplierSpend[sid].invoiceCount++;
        if (d.invoiceDate && d.invoiceDate > supplierSpend[sid].lastInvoiceDate) supplierSpend[sid].lastInvoiceDate = d.invoiceDate;
      }
      const spendEntries = Object.values(supplierSpend).filter(s => s.totalSpend > 0).sort((a, b) => b.totalSpend - a.totalSpend);
      if (spendEntries.length > 0) {
        invoiceSpendLines.push(`SUPPLIER SPEND (last 90 days, from scanned invoices):`);
        spendEntries.forEach(s => invoiceSpendLines.push(`  - ${s.name}: $${s.totalSpend.toFixed(2)} across ${s.invoiceCount} invoice${s.invoiceCount !== 1 ? "s" : ""}${s.lastInvoiceDate ? `, last invoice ${s.lastInvoiceDate}` : ""}`));
      }
    }

    // Recent credit notes
    const creditNotesSnap = await db
      .collection(`venues/${venueId}/invoices`)
      .where('type', '==', 'credit_note')
      .orderBy('invoiceDate', 'desc')
      .limit(10)
      .get()
      .catch(() => ({ docs: [] }));

    const recentCreditNotes = creditNotesSnap.docs.map(d => ({
      date: d.data().invoiceDate,
      supplier: d.data().supplierName,
      amount: d.data().totalAmount,
      linkedInvoice: d.data().originalInvoiceId || 'not specified'
    }));

    // Pending deliveries awaiting invoice confirmation
    const pendingDeliveriesSnap = await db
      .collection(`venues/${venueId}/pendingDeliveries`)
      .where('status', '==', 'awaiting_invoice')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get()
      .catch(() => ({ docs: [] }));

    const pendingDeliveries = pendingDeliveriesSnap.docs.map(d => ({
      supplier: d.data().supplierName,
      deliveryDate: d.data().deliveryDate,
      provisionalCost: d.data().provisionalCost,
      packingSlipRef: d.data().packingSlipRef,
    }));

    // ── Build context payload ─────────────────────────────────────────────────
    const lines: string[] = [
      "=== VENUE DATA SNAPSHOT ===",
      "",
      "STOCKTAKE STATUS:",
      `  Has count data: ${hasCountData}`,
      `  Has previous cycle baseline: ${hasPrevCycle}`,
      hasPrevCycle
        ? "  Variance comparison against previous cycle is available."
        : "  First stocktake only — no previous cycle baseline yet. Report on current stock levels, items below PAR, and zero stock.",
      "",
      "CURRENT STOCKTAKE:",
      `  Total shortage: $${shortfallDollars.toFixed(2)}`,
      `  Total excess: $${excessDollars.toFixed(2)}`,
      `  Items counted: ${totalItemsCounted}`,
      `  Estimated stock holding value: $${stockHoldingValue.toFixed(2)}`,
      "",
      "TOP SHORTAGES (by dollar value):",
      ...allShortages.slice(0, 10).map(s =>
        `  - ${s.name}: ${s.varianceUnits} units${s.dollarVariance > 0 ? ` (-$${s.dollarVariance.toFixed(2)})` : ""} [${s.deptName}/${s.areaName}]`
      ),
      "",
      "TOP EXCESSES:",
      ...allExcesses.slice(0, 5).map(e =>
        `  - ${e.name}: +${e.varianceUnits} units${e.dollarVariance > 0 ? ` ($${e.dollarVariance.toFixed(2)})` : ""} [${e.deptName}/${e.areaName}]`
      ),
      "",
      "TREND ITEMS (short 2+ consecutive cycles):",
      trendItems.length ? trendItems.map(t => `  - ${t.name} (${t.deptName})`).join("\n") : "  None detected yet",
      "",
      `PRODUCTS IN SYSTEM: ${products.length}`,
    ];

    if (supplierContactLines.length > 0) {
      lines.push("", "SUPPLIERS ON FILE (name | email | phone | account | lead time):");
      lines.push(...supplierContactLines);
    } else {
      lines.push("SUPPLIERS: None");
    }

    if (deptContextLines.length > 0) {
      lines.push("", "DEPARTMENTS (cycles completed, last cycle date, area progress):");
      lines.push(...deptContextLines);
    }

    if (slowMovers.length > 0) {
      lines.push("", "SLOW/UNCOUNTED PRODUCTS (30+ days without a count):");
      slowMovers.forEach(p => lines.push(`  - ${p.name}${p.costPrice ? ` ($${p.costPrice}/unit)` : ""}`));
    }

    if (trackedSlowMoverLines.length > 0) {
      lines.push("", ...trackedSlowMoverLines);
    }

    if (recentOrders.length > 0) {
      lines.push("", "RECENT ORDERS (newest first):");
      recentOrders.forEach(o =>
        lines.push(`  - ${o.supplierName}: ${o.status}${o.totalValue ? ` ($${o.totalValue.toFixed(2)})` : ""}${o.createdAt ? ` on ${o.createdAt}` : ""}`)
      );
    }

    if (salesSummary) {
      lines.push("", "RECENT SALES DATA:", salesSummary);
    }

    if (priceChangeLines.length > 0) {
      lines.push("", ...priceChangeLines);
    }

    if (pendingFlagLines.length > 0) {
      lines.push("", ...pendingFlagLines);
    }

    if (invoiceSpendLines.length > 0) {
      lines.push("", ...invoiceSpendLines);
    }

    lines.push(
      "",
      "CREDIT NOTES (recent):",
      recentCreditNotes.length === 0
        ? "No recent credit notes."
        : recentCreditNotes.map(c => `${c.date} — ${c.supplier} ${Math.abs(c.amount)} credit`).join("\n")
    );

    if (pendingDeliveries.length > 0) {
      lines.push(
        "",
        "PENDING DELIVERIES (awaiting invoice):",
        ...pendingDeliveries.map(p =>
          `  - ${p.supplier || "Unknown supplier"}${p.deliveryDate ? ` on ${p.deliveryDate}` : ""}${p.provisionalCost ? ` (provisional cost $${Number(p.provisionalCost).toFixed(2)})` : ""}${p.packingSlipRef ? `, ref ${p.packingSlipRef}` : ""}`
        )
      );
    }

    if (snapshotContextLines.length > 0) {
      lines.push("", "CYCLE SNAPSHOT INTELLIGENCE (per department, from last completed snapshot):");
      lines.push(...snapshotContextLines);
    }

    // Velocity performance context (built from snapshot items during dept traversal above)
    const velocityLines: string[] = [];
    try {
      type VelItem = { name: string; avgVelocity: number; currentStock: number; daysToSell: number | null; status: string; costPrice: number | null; parLevel: number | null; belowPar: boolean };
      const velItems: VelItem[] = [];
      productCycles.forEach((data, name) => {
        const validVel = data.velocities.filter(v => v !== 0);
        const avgVelocity = validVel.length > 0 ? validVel.reduce((a, b) => a + b, 0) / validVel.length : 0;
        const daysToSell = avgVelocity > 0 ? Math.round((data.lastStock / avgVelocity) * 7) : null;
        let status = 'stagnant';
        if (avgVelocity > 2) status = 'fast';
        else if (avgVelocity >= 0.5) status = 'healthy';
        else if (avgVelocity >= 0.1) status = 'slow';
        const belowPar = data.parLevel != null ? data.lastStock < data.parLevel : false;
        velItems.push({ name, avgVelocity, currentStock: data.lastStock, daysToSell, status, costPrice: data.costPrice, parLevel: data.parLevel, belowPar });
      });

      const fast = velItems.filter(v => v.status === 'fast').sort((a, b) => b.avgVelocity - a.avgVelocity).slice(0, 10);
      const slow = velItems.filter(v => v.status === 'slow' || v.status === 'stagnant').sort((a, b) => a.avgVelocity - b.avgVelocity).slice(0, 10);
      const belowPar = velItems.filter(v => v.belowPar).slice(0, 8);
      const stagnant = velItems.filter(v => v.status === 'stagnant' && v.costPrice != null).sort((a, b) => (b.currentStock * (b.costPrice ?? 0)) - (a.currentStock * (a.costPrice ?? 0))).slice(0, 5);

      if (fast.length > 0) {
        velocityLines.push(`TOP FAST MOVERS (${fast.length}):`);
        fast.forEach(v => velocityLines.push(`  - ${v.name}: ${v.avgVelocity.toFixed(1)}/wk, stock ${v.currentStock}${v.daysToSell != null ? `, ${v.daysToSell}d to sell` : ''}`));
      }
      if (slow.length > 0) {
        velocityLines.push(`SLOW/STAGNANT PRODUCTS (${slow.length}):`);
        slow.forEach(v => {
          const deadCost = v.costPrice != null ? ` — $${(v.currentStock * v.costPrice).toFixed(0)} tied up` : '';
          velocityLines.push(`  - ${v.name}: ${v.avgVelocity.toFixed(2)}/wk, stock ${v.currentStock}${deadCost}`);
        });
      }
      if (belowPar.length > 0) {
        velocityLines.push(`BELOW PAR (${belowPar.length} products):`);
        belowPar.forEach(v => velocityLines.push(`  - ${v.name}: stock ${v.currentStock}, PAR ${v.parLevel}`));
      }
      if (stagnant.length > 0) {
        velocityLines.push(`HIGHEST VALUE DEAD STOCK:`);
        stagnant.forEach(v => {
          const val = v.costPrice != null ? `$${(v.currentStock * v.costPrice).toFixed(0)}` : '';
          velocityLines.push(`  - ${v.name}: ${v.currentStock} units${val ? ` (${val})` : ''}, no movement`);
        });
      }
    } catch (e: any) {
      console.log("[api/suitee] velocity calc error", e?.message);
    }

    if (velocityLines.length > 0) {
      lines.push("", "PRODUCT PERFORMANCE (calculated from stocktake cycles):");
      lines.push(...velocityLines);
    }

    if (productSupplierLines.length > 0) {
      lines.push("", "SUPPLIER PRICING (top products — ⭐=preferred, format: supplier(relationship,$cost/unit)):");
      productSupplierLines.forEach(l => lines.push("  " + l));
    }

    // New data sources: budgets, wastage, recipes
    if (budgetsSnap && !budgetsSnap.empty) {
      lines.push("", "BUDGETS:");
      budgetsSnap.docs.forEach(b => {
        const d = b.data() as any;
        const target = typeof d.amount === 'number' ? `$${d.amount.toFixed(2)}` : 'no amount';
        const start = d.periodStart?.toDate?.()?.toISOString?.()?.slice(0, 10);
        const end = d.periodEnd?.toDate?.()?.toISOString?.()?.slice(0, 10);
        const period = [start, end].filter(Boolean).join(' → ');
        const scope = d.supplierId ? `supplier: ${supplierNameById.get(d.supplierId) || d.supplierId}` : 'all suppliers';
        lines.push(`  - target ${target}${period ? `, period ${period}` : ''}, ${scope}${d.notes ? ` — ${d.notes}` : ''}`);
      });
    }

    if (wastageSnap && !wastageSnap.empty) {
      const totalWasteQty = wastageSnap.docs.reduce((s, d) => s + ((d.data() as any).quantity || 0), 0);
      lines.push("", `WASTAGE (last 90 days): ${wastageSnap.docs.length} records, ~${totalWasteQty.toFixed(1)} total units`);
      const byProduct: Record<string, number> = {};
      wastageSnap.docs.forEach(d => {
        const wd = d.data() as any;
        const name = wd.productName || 'Unknown';
        byProduct[name] = (byProduct[name] || 0) + (wd.quantity || 0);
      });
      Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([name, qty]) => {
        lines.push(`  - ${name}: ${qty.toFixed(1)} units wasted`);
      });
    }

    if (recipesSnap && !recipesSnap.empty) {
      lines.push("", "CONFIRMED RECIPES (GP% from stored value — not from live sales):");
      recipesSnap.docs.forEach(r => {
        const d = r.data() as any;
        const parts: string[] = [d.name || r.id];
        if (typeof d.rrp === 'number') parts.push(`sell $${d.rrp.toFixed(2)}`);
        if (typeof d.gpPct === 'number') parts.push(`GP ${d.gpPct.toFixed(1)}%`);
        else parts.push('no GP set');
        if (typeof d.cogs === 'number') parts.push(`COGS $${d.cogs.toFixed(2)}`);
        lines.push(`  - ${parts.join(' | ')}`);
      });
    }

    // Pour variance — compares theoretical ingredient usage (recipe spec qty × serves
    // sold, derived from sales reports) against actual stock depletion rate (derived
    // from stocktake velocity). Pure heuristic — needs confirmed recipes with linked
    // products + pack sizes, sales reports with a period, and counted cycles.
    try {
      const confirmedRecipes = (recipesSnap?.docs || []).map(r => ({ id: r.id, ...(r.data() as any) }));

      const cyclesByProductId = new Map<string, { velocities: number[] }>();
      productCycles.forEach(entry => {
        if (entry.productId && !cyclesByProductId.has(entry.productId)) cyclesByProductId.set(entry.productId, entry);
      });

      // Match sales report lines to confirmed recipe names (fuzzy), accumulating
      // qty sold per recipe and total period length so we can derive serves/week.
      const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      const matchScore = (a: string, b: string): number => {
        const x = norm(a), y = norm(b);
        if (!x || !y) return 0;
        if (x === y) return 1;
        if (x.includes(y) || y.includes(x)) return 0.9;
        const xWords = new Set(x.split(' '));
        const yWords = y.split(' ');
        const overlap = yWords.filter(w => xWords.has(w)).length;
        return overlap > 0 ? (overlap / Math.max(xWords.size, yWords.length)) * 0.8 : 0;
      };

      let totalSalesWeeks = 0;
      const recipeSales = new Map<string, { recipeName: string; qtySold: number }>();
      (salesSnap?.docs || []).forEach(d => {
        const data = d.data() as any;
        const report = data.report;
        if (!report || !Array.isArray(report.lines)) return;
        const ps = report.period?.start ? new Date(report.period.start) : null;
        const pe = report.period?.end ? new Date(report.period.end) : null;
        let weeks = 0;
        if (ps && pe && pe.getTime() > ps.getTime()) weeks = (pe.getTime() - ps.getTime()) / (7 * 24 * 60 * 60 * 1000);
        if (weeks > 0) totalSalesWeeks += weeks;

        for (const line of report.lines) {
          const lineName = String(line?.name || '');
          const qtySold = typeof line?.qtySold === 'number' ? line.qtySold : 0;
          if (!lineName.trim() || qtySold <= 0) continue;
          let bestRecipe: any = null, bestScore = 0;
          for (const r of confirmedRecipes) {
            const score = matchScore(lineName, r.name || '');
            if (score > bestScore) { bestScore = score; bestRecipe = r; }
          }
          if (!bestRecipe || bestScore < 0.6) continue;
          const existing = recipeSales.get(bestRecipe.id);
          if (existing) existing.qtySold += qtySold;
          else recipeSales.set(bestRecipe.id, { recipeName: bestRecipe.name || bestRecipe.id, qtySold });
        }
      });

      type PourVar = {
        recipeName: string; ingredientName: string; specQtyPerServe: number; unit: string;
        serves: number; variancePct: number; impliedQtyPerServe: number | null; confidence: 'high' | 'medium' | 'low';
      };
      const pourVariance: PourVar[] = [];

      if (totalSalesWeeks > 0) {
        for (const recipe of confirmedRecipes) {
          const stat = recipeSales.get(recipe.id);
          if (!stat || stat.qtySold <= 0) continue;
          const servesPerWeek = stat.qtySold / totalSalesWeeks;
          if (servesPerWeek <= 0) continue;

          const items: any[] = Array.isArray(recipe.items) ? recipe.items : [];
          for (const ing of items) {
            const productId: string | null = ing?.productId || null;
            const specQty = typeof ing?.qty === 'number' ? ing.qty : 0;
            if (!productId || specQty <= 0) continue;

            const cycleEntry = cyclesByProductId.get(productId);
            if (!cycleEntry) continue;
            const validVel = cycleEntry.velocities.filter(v => v !== 0);
            if (validVel.length === 0) continue;
            const actualRateUnits = validVel.reduce((a, b) => a + b, 0) / validVel.length;
            if (actualRateUnits <= 0) continue;

            // Convert the per-serve spec (ml/g/each) into a theoretical depletion rate
            // in stock units/week, using the pack size captured on the recipe item —
            // this is the unit the operator actually counts in (e.g. bottles).
            const unit = String(ing.unit || '').toLowerCase();
            const theoreticalNativePerWeek = specQty * servesPerWeek;
            let theoreticalRateUnits: number | null = null;
            let impliedQtyPerServe: number | null = null;

            if ((unit === 'ml' || unit === 'l') && typeof ing.packSizeMl === 'number' && ing.packSizeMl > 0) {
              const mlPerWeek = unit === 'l' ? theoreticalNativePerWeek * 1000 : theoreticalNativePerWeek;
              theoreticalRateUnits = mlPerWeek / ing.packSizeMl;
              const impliedMl = (actualRateUnits * ing.packSizeMl) / servesPerWeek;
              impliedQtyPerServe = unit === 'l' ? impliedMl / 1000 : impliedMl;
            } else if ((unit === 'g' || unit === 'kg') && typeof ing.packSizeG === 'number' && ing.packSizeG > 0) {
              const gPerWeek = unit === 'kg' ? theoreticalNativePerWeek * 1000 : theoreticalNativePerWeek;
              theoreticalRateUnits = gPerWeek / ing.packSizeG;
              const impliedG = (actualRateUnits * ing.packSizeG) / servesPerWeek;
              impliedQtyPerServe = unit === 'kg' ? impliedG / 1000 : impliedG;
            } else if (unit === 'each' || unit === 'ea' || unit === 'unit' || unit === 'count' || unit === '') {
              theoreticalRateUnits = theoreticalNativePerWeek;
              impliedQtyPerServe = actualRateUnits / servesPerWeek;
            }
            // Other units (no matching pack size on the recipe item): not enough
            // data to convert between recipe spec and stock-counted units — skip.
            if (theoreticalRateUnits == null || theoreticalRateUnits <= 0) continue;

            const variancePct = ((actualRateUnits - theoreticalRateUnits) / theoreticalRateUnits) * 100;
            const confidence: 'high' | 'medium' | 'low' =
              stat.qtySold > 50 && (ing.packSizeMl || ing.packSizeG) ? 'high'
              : stat.qtySold > 20 ? 'medium'
              : 'low';

            pourVariance.push({
              recipeName: recipe.name || '',
              ingredientName: ing.productName || '',
              specQtyPerServe: specQty,
              unit: ing.unit || '',
              serves: Math.round(stat.qtySold),
              variancePct,
              impliedQtyPerServe,
              confidence,
            });
          }
        }
      }

      const significantVariance = pourVariance
        .filter(v => Math.abs(v.variancePct) > 5)
        .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
        .slice(0, 10);

      lines.push("", "RECIPE POUR VARIANCE (theoretical spec usage vs actual stock depletion — heuristic):");
      if (significantVariance.length > 0) {
        significantVariance.forEach(v => {
          const direction = v.variancePct > 0 ? 'over' : 'under';
          const pct = Math.abs(v.variancePct).toFixed(1);
          const implied = v.impliedQtyPerServe != null
            ? ` (implies ~${v.impliedQtyPerServe.toFixed(0)}${v.unit}/serve vs ${v.specQtyPerServe}${v.unit} spec)`
            : '';
          lines.push(`  - ${v.recipeName} — ${v.ingredientName}: ${pct}% ${direction}-pour detected across ~${v.serves} serves sold${implied}. Confidence: ${v.confidence}.`);
        });
      } else if (pourVariance.length > 0) {
        lines.push("  All recipe pours within 5% tolerance.");
      } else {
        lines.push("  No pour variance data available (requires confirmed recipes with linked products and pack sizes, sales reports with a date range, and counted stocktake cycles).");
      }
    } catch (e: any) {
      console.log("[api/suitee] pour variance calc error", e?.message);
    }

    // Add Hosti Health summary to context
    try {
      const now = new Date();
      const monthKey = now.toISOString().slice(0, 7);
      const healthSnap = await db.doc(`venues/${venueId}/profitRecoverySnapshots/${monthKey}`).get();
      if (healthSnap.exists) {
        const h = healthSnap.data() as any;
        lines.push('', 'HOSTI HEALTH SCORE (current month):');
        if (h.score != null) {
          lines.push(`  Score: ${h.score}/100 (${h.confidence || 'Building'})`);
          lines.push(`  Label: ${h.score >= 90 ? 'Excellent' : h.score >= 75 ? 'Strong' : h.score >= 60 ? 'Developing' : h.score >= 40 ? 'Needs attention' : 'At risk'}`);
          if (h.kpiScores) {
            lines.push('  KPI breakdown:');
            if (h.kpiScores.stockAccuracy != null) lines.push(`    - Stock Accuracy: ${Math.round(h.kpiScores.stockAccuracy)}/100`);
            if (h.kpiScores.labourEfficiency != null) lines.push(`    - Labour Efficiency: ${Math.round(h.kpiScores.labourEfficiency)}/100`);
            if (h.kpiScores.inventoryHealth != null) lines.push(`    - Inventory Health: ${Math.round(h.kpiScores.inventoryHealth)}/100`);
            if (h.kpiScores.orderingIntelligence != null) lines.push(`    - Ordering Intelligence: ${Math.round(h.kpiScores.orderingIntelligence)}/100`);
          }
          if (h.estimatedImpact != null && h.estimatedImpact > 0) {
            lines.push(`  Estimated financial impact: $${Math.round(h.estimatedImpact)} recovered this cycle`);
          }
          if (h.varianceDollars != null) {
            lines.push(`  Total variance: $${Math.abs(Math.round(h.varianceDollars))} (absolute, all departments)`);
          }
          if (h.stockValue != null) {
            lines.push(`  Operational stock value: $${Math.round(h.stockValue)}`);
          }
          if (h.paretoTop3?.length) {
            lines.push('  Top variance drivers (Focus List):');
            h.paretoTop3.forEach((p: any, i: number) => {
              const dir = p.varianceDollars < 0 ? 'short' : 'excess';
              const area = p.areaName ? ` (${p.areaName})` : '';
              lines.push(`    ${i + 1}. ${p.name}${area}: $${Math.abs(Math.round(p.varianceDollars))} ${dir} — ${p.contributionPct}% of total variance`);
            });
          }
          if (h.topInsight) {
            lines.push(`  Primary insight: ${h.topInsight.pattern}`);
            lines.push(`    Most likely cause: ${h.topInsight.mostLikelyExplanation} (${h.topInsight.confidenceLabel} confidence, ${h.topInsight.confidence}%)`);
            lines.push(`    Recommended action: ${h.topInsight.actionable}`);
          }
          if (h.constraintDescription) {
            lines.push(`  Primary operational constraint: ${h.constraintDescription}`);
            lines.push(`    Fix: ${h.constraintFixAction} (${h.constraintImpact} impact)`);
          }
          if (h.daysOfCover != null) {
            lines.push(`  Days of cover: ${h.daysOfCover} days (target: ${h.targetDaysOfCover ?? 10} days, healthy range: 7–14)`);
            if (h.operationalStockValue != null) lines.push(`  Operational stock value: $${Math.round(h.operationalStockValue)}`);
            if (h.cellarStockValue != null && h.cellarStockValue > 0) lines.push(`  Cellar/premium stock (excluded from DoC): $${Math.round(h.cellarStockValue)}`);
          }
        } else {
          lines.push('  Score not yet calculated — insufficient data (needs 2+ completed stocktakes)');
        }
      }
    } catch (e: any) {
      console.log('[api/suitee] health context error', e?.message);
      // Non-fatal
    }

    const context = lines.join("\n");

    const systemPrompt = `You are Suitee, the venue intelligence assistant for Hosti.
You have been given real data from this venue's stocktake and ordering history. Answer the operator's question using only this data — never invent numbers or make assumptions beyond what the data shows.

You answer questions like:
- What was my GP last month?
- Which product has the worst variance?
- When did we last run out of Hendricks?
- Which supplier is costing us the most?
- What are my slowest moving lines?
- Which supplier has increased prices the most?
- How much have price increases cost us?
- Who is the cheapest supplier for Heineken?
- Which products have multiple suppliers?
- Where am I getting the best deals?
- Which supplier should I order beer from?
- Are my staff over-pouring?
- Why is my Kahlua usage so high?
- Why is my Hosti Health score low?
- How do I improve my Stock Accuracy?
- What's my Days of Cover and is it healthy?
- What are my biggest variance drivers?
- What should I focus on to improve my score?

## Hosti Health — your primary guide for improvement

Hosti Health is the venue's overall operational score (0–100), calculated from five KPIs:

1. STOCK ACCURACY (30% weight) — measures variance as a percentage of total stock value. Healthy venues score 80+. Lower scores mean product is going missing faster than expected. Improvement: count more frequently, investigate the Focus List (top 3 variance products), check pour specs on high-variance spirits.

2. LABOUR EFFICIENCY (20% weight) — measures how efficiently stocktakes are run compared to the venue's baseline. Improvement: consistent counting rhythm, voice counting, multiple staff counting simultaneously.

3. INVENTORY HEALTH (20% weight) — measures Days of Cover (how many days of stock you're holding at current consumption). Healthy range: 7–14 days (or the venue's configured target). Too high = over-ordering, capital tied up. Too low = stockout risk. Improvement: align order quantities with the Suggested Orders feature.

4. ORDERING INTELLIGENCE (15% weight, confidence-adjusted) — measures how often Suggested Orders are acted on. Weight increases as more stocktakes complete and velocity data improves. Improvement: use Suggested Orders after each stocktake, adjust quantities, place orders promptly.

5. WASTE CONTROL (15% weight) — coming soon. Will track wastage logs once that feature is built.

## Score benchmarks (NZ/AU hospitality)
- 90–100: Excellent — top-tier operational discipline
- 75–89: Strong — well-run with minor opportunities
- 60–74: Developing — specific KPIs need attention
- 40–59: Needs attention — meaningful leakage occurring
- 0–39: At risk — significant operational gaps

## Abductive insights — what the data suggests
When the data shows a pattern, Hosti Health generates an insight about the most likely cause. For example:
- Concentrated variance in one product → most likely systematic overpouring, wastage, or theft
- Variance improving trend → controls are working, something changed for the better
- Variance worsening trend → something changed since the last stocktake (staff, menu, supplier)
- Days of Cover > 21 → ordering is outpacing consumption
- Days of Cover < 5 → stockout risk within days

When a user asks about their score or insights, explain the specific pattern and what it most likely means for their venue, using the data in context.

## Constraint analysis — the primary bottleneck
The system identifies the single biggest constraint on score improvement:
- Stocktake frequency too low (most common) — counting every 45 days means variance runs undetected for weeks
- Missing cost prices — without prices, financial impact can't be calculated
- Single department — area-specific variance can't be identified

When asked how to improve, start with the constraint — fixing the biggest bottleneck has more impact than fixing secondary issues.

## Days of Cover guidance
Days of Cover = how many days of operational stock the venue currently holds.
Formula: operational stock value ÷ daily consumption rate (from cycle data).
Cellar and premium stock (high-cost, low-velocity products) is excluded from this calculation automatically.
Healthy: 7–14 days for most NZ/AU hospitality venues. Venues with daily deliveries can run 3–5 days. Remote venues may need 14–21 days.

## Predictive stockout warnings
When the system detects a product will run out within 14 days at current consumption:
- Critical (< 3 days): immediate action needed
- Warning (3–7 days): order soon
- Watch (7–14 days): monitor
These are based on EMA velocity (exponentially weighted average across all cycles — a single event week doesn't distort the prediction).

## Confidence on insights
All insights carry a confidence percentage based on how many stocktakes have been completed and how consistent the pattern is. 6+ stocktakes = High confidence. 3–5 = Medium. Fewer = Low. Always mention confidence when it's relevant to how much action a user should take.

## Tone and style
Direct, analytical, honest — like a trusted CFO who respects the operator's time. No fluff. Give the number first, then the context.

If the data doesn't contain enough information to answer confidently, say so clearly: "I don't have enough data to answer that yet. Complete X more stocktakes to unlock this insight."

For pour variance questions: state the spec, the implied actual, and the confidence level. Always note whether the variance is more consistent with over-pouring, under-pouring, spillage, or measurement error — never accuse staff. Frame it as "the data suggests", not "your staff are".

Never answer questions about how to use the app — direct those to Izzy.

${SUITEE_COUNTING_NOTE}

${context}`;

    // Build multi-turn messages (history + current question)
    const messages: { role: string; content: string }[] = [];
    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: String(msg.text || msg.content || "") });
        }
      }
    }
    messages.push({ role: "user", content: question });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: systemPrompt,
        messages,
      }),
    });
    if (!claudeResp.ok) {
      const err = await claudeResp.text().catch(() => "");
      throw new Error("Claude API error: " + err);
    }
    const claudeData = await claudeResp.json() as any;
    const answer = claudeData?.content?.[0]?.text || "I'm having trouble accessing your data right now. Please try again.";

    const suiteeMeter = await trackAiCall(venueId, 'suitee');
    console.log("[api/suitee] OK", { uid, venueId, questionLength: question.length });
    res.json({ ok: true, answer, usageWarning: suiteeMeter.usageWarning ?? null });

  } catch (e: any) {
    console.error("[api/suitee] ERROR", e?.message || e);
    res.json({ ok: false, answer: "I'm having trouble accessing your data right now. Please try again." });
  }
});

// ── POST /izzy ────────────────────────────────────────────────────────────────
app.post("/izzy", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { question, venueId: izzyVenueId } = req.body || {};
    if (!question || typeof question !== "string") {
      res.status(400).json({ ok: false, error: "Missing question" }); return;
    }
    if (izzyVenueId) {
      const lcIZ = await checkAiLimit(izzyVenueId, 'izzy');
      if (!lcIZ.allowed) { res.status(429).json(lcIZ.limitError); return; }
    }
    const systemPrompt = `You are Izzy, the friendly in-app guide for Hosti.
You help hospitality venue staff use the app confidently.
You have a warm, experienced bartender tone — helpful, direct, never condescending.

You only answer questions about Hosti.
For any other topic say: "I'm only able to help with Hosti questions — ask me anything about the app!"

Use this exact feature knowledge to answer questions:

${IZZY_FEATURES.available}

When asked about a planned feature respond like this:
"That feature isn't live just yet but it's on our roadmap for a future update — exciting things coming! In the meantime, here's what you can do today: [suggest the closest available alternative]"

Planned features:
${IZZY_FEATURES.planned}

When asked about something not on either list respond:
"That feature isn't available at the moment. If it's something you'd find useful, contact our support team at office@hosti.co.nz and we'll look into it for you."

NEVER invent features that don't exist.
NEVER suggest workflows that aren't in the available list.
ALWAYS be honest about what the app can and cannot do.
ALWAYS be encouraging and warm — never apologetic.
Keep answers concise — 2 to 5 sentences unless a step-by-step is needed.

You also have practical counting guidance to help users with how-to questions:

${COUNTING_GUIDANCE}

Use this when users ask questions like:
- How do I count a partial bottle?
- How do I count a keg?
- How do I use the scale?
- Where is the barcode?
- How do I count flour or weight items?
- What does 0.5 mean?

Always give practical, direct answers.
Never make the user feel like they asked a silly question.

Current screen context will be provided with each message. Use it to give context-aware answers where possible.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!claudeResp.ok) {
      const err = await claudeResp.text().catch(() => "");
      throw new Error("Claude API error: " + err);
    }
    const data = await claudeResp.json() as any;
    const answer = data?.content?.[0]?.text || "I'm having trouble right now. Please try again.";
    let izzyWarning = null;
    if (izzyVenueId) izzyWarning = (await trackAiCall(izzyVenueId, 'izzy')).usageWarning ?? null;
    console.log("[api/izzy] OK", { uid, questionLength: question.length });
    res.json({ ok: true, answer, usageWarning: izzyWarning });
  } catch (e: any) {
    console.error("[api/izzy] ERROR", e?.message || e);
    res.json({ ok: false, answer: "I'm having trouble right now. Please try again." });
  }
});

// ── Festival Suitee handler ───────────────────────────────────────────────────

async function handleFestivalSuitee(
  venueId: string,
  question: string,
  uid: string,
  db: admin.firestore.Firestore,
  history: any[],
): Promise<string> {
  const lines: string[] = ["=== FESTIVAL EVENT DATA SNAPSHOT ===", ""];

  // Event details
  try {
    const evSnap = await db.doc(`venues/${venueId}/event/details`).get();
    if (evSnap.exists) {
      const ev = evSnap.data() as any;
      lines.push("EVENT:");
      lines.push(`  Name: ${ev.eventName || "Unknown"}`);
      lines.push(`  Dates: ${ev.startDate || "?"} → ${ev.endDate || "?"}`);
      lines.push(`  Status: ${ev.status || "active"}`);
      lines.push(`  Cycle: ${ev.cycleLength || "daily"}`);
      if (ev.stockModel) lines.push(`  Stock model: ${ev.stockModel}`);
      if (ev.dailyAttendance) lines.push(`  Daily attendance: ${ev.dailyAttendance}`);

      // Supplier configs (return allowances)
      const cfgs = ev.supplierConfigs || {};
      const cfgEntries = Object.values(cfgs) as any[];
      if (cfgEntries.length > 0) {
        lines.push("", "SUPPLIER RETURN ALLOWANCES:");
        cfgEntries.forEach((c: any) => {
          lines.push(`  ${c.supplierName}: ${c.returnAllowancePercent ?? 5}% allowance, policy: ${c.returnPolicy || "sale_or_return"}`);
        });
      }
    }
  } catch {}

  // Bar stock (reads from departments/{barId}/areas/back-of-house/items)
  try {
    const barStockByProduct: Record<string, { name: string; total: number; bars: string[] }> = {};
    // Velocity tracking: barName → array of items with velocity
    const barVelocity: Record<string, Array<{ name: string; velocity: number; hoursRemaining: number; confidence: string }>> = {};
    const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
    const barDepts = deptsSnap.docs.filter(d => (d.data() as any).isFestivalBar === true);
    for (const barDoc of barDepts) {
      const barName = (barDoc.data() as any).name || barDoc.id;
      const itemsSnap = await db.collection(`venues/${venueId}/departments/${barDoc.id}/areas/back-of-house/items`).get();
      itemsSnap.docs.forEach(d => {
        const data = d.data() as any;
        const pid = d.id;
        if (!barStockByProduct[pid]) {
          barStockByProduct[pid] = { name: data.name || data.productName || pid, total: 0, bars: [] };
        }
        const qty = data.lastCount ?? data.currentStock ?? 0;
        barStockByProduct[pid].total += qty;
        if (qty > 0) barStockByProduct[pid].bars.push(`${barName}:${qty}`);
        // Track velocity if available
        if (data.velocity && data.velocity > 0) {
          if (!barVelocity[barName]) barVelocity[barName] = [];
          barVelocity[barName].push({
            name: data.name || data.productName || pid,
            velocity: data.velocity,
            hoursRemaining: qty / data.velocity,
            confidence: data.velocityConfidence || 'unknown',
          });
        }
      });
    }
    const entries = Object.values(barStockByProduct).filter(e => e.total > 0).sort((a, b) => b.total - a.total);
    if (entries.length > 0) {
      lines.push("", `BAR STOCK TOTALS (${entries.length} products):`);
      entries.slice(0, 30).forEach(e => {
        lines.push(`  ${e.name}: ${e.total} total (${e.bars.join(", ")})`);
      });
    }
    // Bar velocity section — enables Suitee to answer "how long until Bar X runs out?"
    const velBarNames = Object.keys(barVelocity);
    if (velBarNames.length > 0) {
      lines.push("", "BAR VELOCITY (units/hr · hours remaining):");
      for (const barName of velBarNames) {
        const items = barVelocity[barName].sort((a, b) => a.hoursRemaining - b.hoursRemaining);
        lines.push(`  ${barName}:`);
        items.forEach(item => {
          const alert = item.hoursRemaining < 1 ? " ⚠️ CRITICAL" : item.hoursRemaining < 2 ? " ⚠ watch" : "";
          lines.push(`    ${item.name}: ${item.velocity.toFixed(1)}/hr · ~${item.hoursRemaining.toFixed(1)}hrs remaining${alert} (${item.confidence} confidence)`);
        });
      }
    } else {
      lines.push("", "BAR VELOCITY: Not yet calculated (session counts needed).");
    }

    // HQ storage locations (reads from departments/hq/areas/{areaId}/items)
    const hqAreasSnap = await db.collection(`venues/${venueId}/departments/hq/areas`).get();
    const srcLines: string[] = [];
    for (const areaDoc of hqAreasSnap.docs) {
      const areaName = (areaDoc.data() as any).name || areaDoc.id;
      const itemsSnap = await db.collection(`venues/${venueId}/departments/hq/areas/${areaDoc.id}/items`).get();
      itemsSnap.docs.forEach(d => {
        const data = d.data() as any;
        const qty = data.lastCount ?? data.currentStock ?? 0;
        if (qty > 0) srcLines.push(`  ${data.name || data.productName || d.id}: ${qty} at ${areaName}`);
      });
    }
    if (srcLines.length > 0) {
      lines.push("", "HQ STORAGE STOCK:");
      lines.push(...srcLines);
    }
  } catch {}

  // Recent transfers (last 48h)
  try {
    const since48h = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000));
    const txSnap = await db.collection(`venues/${venueId}/transfers`)
      .where("createdAt", ">=", since48h).limit(20).get();
    if (!txSnap.empty) {
      lines.push("", `TRANSFERS (last 48h, ${txSnap.size}):`);
      txSnap.docs.forEach(d => {
        const t = d.data() as any;
        lines.push(`  ${t.productName || "?"}: ${t.quantity} from ${t.fromBarName || "?"} → ${t.toBarName || "?"}`);
      });
    }
  } catch {}

  // Recent requests (last 48h)
  try {
    const since48h = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000));
    const reqSnap = await db.collection(`venues/${venueId}/requests`)
      .where("createdAt", ">=", since48h).limit(20).get();
    if (!reqSnap.empty) {
      lines.push("", `TOP-UP REQUESTS (last 48h, ${reqSnap.size}):`);
      reqSnap.docs.forEach(d => {
        const r = d.data() as any;
        const prods = (r.products || [])
          .map((p: any) => `${p.productName || '?'} ×${p.quantity || '?'}`)
          .join(', ');
        const urgencyTag = r.urgency ? `, ${r.urgency}` : '';
        lines.push(`  ${r.barName || '?'}: ${prods || 'no products listed'} (${r.status || 'pending'}${urgencyTag})`);
      });
    }
  } catch {}

  // Wastage totals — two-tier: per-product (all bars) + per-bar breakdown
  try {
    const wastageSnap = await db.collection(`venues/${venueId}/wastage`).limit(50).get();
    const wastageByProduct: Record<string, { name: string; total: number }> = {};
    const wastageByBar: Record<string, { barName: string; total: number; byProduct: Record<string, { name: string; qty: number }> }> = {};
    let wastageGrandTotal = 0;

    wastageSnap.docs.forEach(d => {
      const data = d.data() as any;
      const pid   = data.itemId || data.productId;
      const bid   = data.barId;
      const pName = data.productName || pid || '?';
      const bName = data.barName || bid || 'Unknown bar';
      const qty   = data.quantity || 0;
      if (!pid || qty <= 0) return;

      // Tier 1: per-product total across all bars
      if (!wastageByProduct[pid]) wastageByProduct[pid] = { name: pName, total: 0 };
      wastageByProduct[pid].total += qty;

      // Tier 2: per-bar with per-product breakdown
      if (bid) {
        if (!wastageByBar[bid]) wastageByBar[bid] = { barName: bName, total: 0, byProduct: {} };
        wastageByBar[bid].total += qty;
        if (!wastageByBar[bid].byProduct[pid]) wastageByBar[bid].byProduct[pid] = { name: pName, qty: 0 };
        wastageByBar[bid].byProduct[pid].qty += qty;
      }

      wastageGrandTotal += qty;
    });

    const wEntries = Object.values(wastageByProduct).filter(e => e.total > 0);
    const bEntries = Object.values(wastageByBar).filter(b => b.total > 0);

    if (wastageGrandTotal > 0) {
      lines.push("", "WASTAGE TOTALS:");
      lines.push(`  Grand total: ${wastageGrandTotal} units across all bars`);
      wEntries.sort((a, b) => b.total - a.total)
              .forEach(e => lines.push(`  ${e.name}: ${e.total} units`));

      if (bEntries.length > 0) {
        lines.push("", "WASTAGE BY BAR:");
        bEntries.sort((a, b) => b.total - a.total).forEach(b => {
          lines.push(`  ${b.barName}: ${b.total} units total`);
          Object.values(b.byProduct).sort((x, y) => y.qty - x.qty)
                .forEach(p => lines.push(`    ${p.name}: ${p.qty}`));
        });
      }
    }
  } catch {}

  // Weekly snapshots (most recent 2)
  try {
    const snapCol = await db.collection(`venues/${venueId}/event/details/weeklySnapshots`).get();
    if (!snapCol.empty) {
      const snaps = snapCol.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      snaps.sort((a, b) => (b.weekNumber || 0) - (a.weekNumber || 0));
      lines.push("", "WEEKLY SNAPSHOTS:");
      snaps.slice(0, 2).forEach(s => {
        lines.push(`  Week ${s.weekNumber}: ${s.sessionCount || 0} sessions, ${s.transferCount || 0} transfers, ${s.requestCount || 0} requests`);
        const soldKeys = Object.keys(s.soldTotals || {});
        if (soldKeys.length > 0) {
          const topSold = soldKeys.map(k => ({ name: s.soldTotals[k].name, sold: s.soldTotals[k].sold }))
            .sort((a, b) => b.sold - a.sold).slice(0, 5);
          lines.push(`    Top sellers: ${topSold.map(p => `${p.name}(${p.sold})`).join(", ")}`);
        }
      });
    }
  } catch {}

  // Sales data
  try {
    const salesSnap = await db
      .collection(`venues/${venueId}/event/details/salesData`)
      .orderBy('uploadedAt', 'desc')
      .limit(10)
      .get();

    const salesUploads = salesSnap.docs.map(d => {
      const data = d.data() as any;
      const totalUnits = (data.lineItems || []).reduce(
        (sum: number, l: any) => sum + (l.unitsSold || 0), 0
      );
      const uploadedAt = data.uploadedAt?.toDate?.()?.toLocaleDateString('en-NZ') ?? '?';
      return { period: data.periodLabel || '?', source: data.source || '?', totalUnits, uploadedAt };
    });

    const hasSalesData = salesUploads.length > 0;
    lines.push("", "SALES DATA:");
    if (hasSalesData) {
      lines.push(`${salesUploads.length} upload(s) on record:`);
      salesUploads.forEach(s => {
        lines.push(`  ${s.period}: ${s.totalUnits} units (${s.source}, uploaded ${s.uploadedAt})`);
      });
      lines.push("Velocity calculations use actual sales data where available.");
    } else {
      lines.push("No sales data uploaded yet.");
      lines.push("Velocity is estimated from session counts.");
      lines.push("Upload a POS export from the Reports tab to improve accuracy.");
    }
  } catch {}

  // Obligations
  try {
    const oblSnap = await db.collection(`venues/${venueId}/obligations`).limit(20).get();
    if (!oblSnap.empty) {
      const pending = oblSnap.docs.filter(d => (d.data() as any).status !== 'fulfilled');
      if (pending.length > 0) {
        lines.push("", `PENDING OBLIGATIONS (${pending.length}):`);
        pending.slice(0, 10).forEach(d => {
          const o = d.data() as any;
          const progressPct = o.progressPercent != null ? `${Math.round(o.progressPercent)}%` : null;
          const projected = o.projectedAtClose != null ? `proj ${o.projectedAtClose}` : null;
          const rec = o.recommendation ? ` | ${o.recommendation}` : '';
          const lastCalc = o.lastCalculatedAt ? ` (calc'd ${new Date(o.lastCalculatedAt._seconds ? o.lastCalculatedAt._seconds * 1000 : o.lastCalculatedAt).toLocaleDateString()})` : '';
          const progressStr = [progressPct, projected].filter(Boolean).join(', ');
          lines.push(`  ${o.supplierName || "?"}: ${o.description || o.type || "?"} (${o.status || "pending"})${progressStr ? ` [${progressStr}]` : ''}${rec}${lastCalc}`);
        });
      }
    }
  } catch {}

  // Open price disputes
  try {
    const disputesSnap = await db.collection(`venues/${venueId}/priceDisputes`)
      .where("status", "==", "open")
      .limit(20)
      .get();
    if (!disputesSnap.empty) {
      const openDisputes = disputesSnap.docs.map(d => d.data() as any);
      const totalOvercharge = openDisputes.reduce((sum, d) => sum + (d.estimatedOvercharge || 0), 0);
      lines.push("", `OPEN PRICE DISPUTES (${openDisputes.length}):`);
      lines.push(`  Total estimated overcharge: $${totalOvercharge.toFixed(2)}`);
      openDisputes.forEach(d => {
        lines.push(`  ${d.productName || "?"} (${d.supplierName || "?"}): agreed $${(d.agreedPrice || 0).toFixed(2)} → invoiced $${(d.invoicePrice || 0).toFixed(2)}, est. overcharge $${(d.estimatedOvercharge || 0).toFixed(2)}`);
      });
    } else {
      lines.push("", "PRICE DISPUTES: None open ✓");
    }
  } catch {}

  const context = lines.join("\n");

  const systemPrompt = `You are Suitee, the festival event intelligence assistant for Hosti.
You have been given real data from this festival venue's event: stock levels across all bars,
transfers, top-up requests, wastage, weekly snapshots, and supplier return allowances.

Answer the operator's question using only this data — never invent numbers.
Your tone is direct, analytical, and practical — like a trusted event ops manager who respects the operator's time.

${FESTIVAL_IZZY_FEATURES}

IMPORTANT: Never suggest pricing changes. Only operational actions: stock redistribution,
transfers between bars, supplier negotiation, write-offs, or demand management.

Revenue figures: only available when sales data has been uploaded (see SALES DATA section above).
If no sales data is uploaded, be honest that you cannot answer revenue or GP questions — direct
the operator to upload a POS export from the Reports tab.

Wastage data is provided in two tiers — WASTAGE TOTALS and WASTAGE BY BAR.
Both are always computed; choose which to surface based on the question:
- Big-picture ("how much did we waste?", "total write-off?") → cite the grand total and WASTAGE TOTALS.
- Specific ("which bar wasted the most?", "what was wasted at Bar 2?") → use WASTAGE BY BAR.
Always include the grand total when discussing wastage so the operator has the headline figure.

${context}`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const messages: { role: string; content: string }[] = [];
  if (Array.isArray(history)) {
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: String(msg.text || msg.content || "") });
      }
    }
  }
  messages.push({ role: "user", content: question });

  const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: systemPrompt,
      messages,
    }),
  });

  if (!claudeResp.ok) {
    const err = await claudeResp.text().catch(() => "");
    throw new Error("Claude API error: " + err);
  }
  const claudeData = await claudeResp.json() as any;
  return claudeData?.content?.[0]?.text || "I'm having trouble accessing your event data right now. Please try again.";
}

// ── POST /closeEventWeek ──────────────────────────────────────────────────────
app.post("/closeEventWeek", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, weekNumber } = req.body || {};
    if (!venueId || !weekNumber) { res.status(400).json({ ok: false, error: "Missing venueId or weekNumber" }); return; }
    await verifyVenueMembership(uid, venueId);

    const db = admin.firestore();
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Gather week data
    const sessionsSnap = await db.collection(`venues/${venueId}/sessions`).get();
    const sessions = sessionsSnap.docs.filter(d => {
      const ts = d.data().completedAt?.toDate?.();
      return ts && ts >= weekStart && ts <= now;
    });

    const transfersSnap = await db.collection(`venues/${venueId}/transfers`).get();
    const transfers = transfersSnap.docs.filter(d => {
      const ts = d.data().createdAt?.toDate?.();
      return ts && ts >= weekStart && ts <= now;
    });

    const requestsSnap = await db.collection(`venues/${venueId}/requests`).get();
    const requests = requestsSnap.docs.filter(d => {
      const ts = d.data().createdAt?.toDate?.();
      return ts && ts >= weekStart && ts <= now;
    });

    // Bar stock at close (reads from departments/{barId}/areas/back-of-house/items)
    const barStockAtClose: Record<string, any> = {};
    const barsDeptsSnap = await db.collection(`venues/${venueId}/departments`).get();
    for (const barDoc of barsDeptsSnap.docs.filter(d => (d.data() as any).isFestivalBar === true)) {
      const itemsSnap = await db.collection(`venues/${venueId}/departments/${barDoc.id}/areas/back-of-house/items`).get();
      itemsSnap.docs.forEach(d => {
        const data = d.data();
        const pid = d.id;
        if (!barStockAtClose[pid]) barStockAtClose[pid] = { name: (data as any).name || (data as any).productName || pid, total: 0 };
        barStockAtClose[pid].total += (data as any).lastCount ?? (data as any).currentStock ?? 0;
      });
    }

    const soldTotals: Record<string, any> = {};
    sessions.forEach(s => {
      (s.data().counts || []).forEach((c: any) => {
        if (!c.productId) return;
        if (!soldTotals[c.productId]) soldTotals[c.productId] = { name: c.productName || c.productId, sold: 0 };
        soldTotals[c.productId].sold += Math.abs(c.variance || 0);
      });
    });

    await db.doc(`venues/${venueId}/event/details/weeklySnapshots/week-${weekNumber}`).set({
      weekNumber,
      weekStart: weekStart.toISOString(),
      weekEnd: now.toISOString(),
      sessionCount: sessions.length,
      transferCount: transfers.length,
      requestCount: requests.length,
      soldTotals,
      barStockAtClose,
      closedAt: admin.firestore.FieldValue.serverTimestamp(),
      closedBy: uid,
      status: 'closed',
    });

    // Update event/details with currentWeek
    await db.doc(`venues/${venueId}/event/details`).set({
      currentWeek: weekNumber + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log("[api/closeEventWeek] OK", { uid, venueId, weekNumber });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/closeEventWeek] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
});

// ── POST /writeFestivalDebrief ─────────────────────────────────────────────────
app.post("/writeFestivalDebrief", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, eventId } = req.body || {};
    if (!venueId || !eventId) { res.status(400).json({ ok: false, error: "Missing venueId or eventId" }); return; }
    await verifyVenueMembership(uid, venueId);

    const db = admin.firestore();

    // Load historic event data
    const evSnap = await db.doc(`venues/${venueId}/eventHistory/${eventId}`).get();
    const ev = evSnap.exists ? evSnap.data() as any : {};

    // Load products with velocity history
    const productsSnap = await db.collection(`venues/${venueId}/products`).limit(100).get();
    const velocityData: string[] = [];
    productsSnap.docs.forEach(d => {
      const data = d.data() as any;
      const vh: number[] = data.velocityHistory || [];
      if (vh.length > 0) {
        const avg = vh.reduce((a: number, b: number) => a + b, 0) / vh.length;
        velocityData.push(`${data.name || d.id}: avg ${avg.toFixed(1)}/day over ${vh.length} event(s)`);
      }
    });

    // Load reconciliation if available
    const recSnap = await db.doc(`venues/${venueId}/eventHistory/${eventId}/reconciliation/summary`).get().catch(() => null);
    const rec = recSnap?.exists ? recSnap.data() as any : null;

    // Load supplier configs from event
    const supplierAllowances: string[] = [];
    if (ev.supplierConfigs) {
      Object.values(ev.supplierConfigs).forEach((cfg: any) => {
        supplierAllowances.push(`${cfg.supplierName}: ${cfg.returnAllowancePercent ?? 5}% allowance`);
      });
    }

    const contextLines = [
      `Event: ${ev.eventName || "Unknown"}`,
      `Dates: ${ev.startDate || "?"} → ${ev.endDate || "?"}`,
      ev.dailyAttendance ? `Daily attendance: ${ev.dailyAttendance}` : "",
      ev.stockModel ? `Stock model: ${ev.stockModel}` : "",
      "",
      rec ? `Reconciliation: sold value $${rec.totalSoldValue?.toFixed(2) || "0"}, return value $${rec.totalReturnValue?.toFixed(2) || "0"}` : "",
      "",
      velocityData.length > 0 ? `PRODUCT VELOCITY:\n${velocityData.slice(0, 20).join("\n")}` : "",
      "",
      supplierAllowances.length > 0 ? `SUPPLIER ALLOWANCES:\n${supplierAllowances.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: `You are an event debrief analyst. Given festival event data, generate a structured debrief with three sections.
Return ONLY valid JSON in this format (no markdown, no other text):
{
  "workedWell": [{"title": "...", "body": "...", "productName": null, "supplierName": null}],
  "improve": [{"title": "...", "body": "...", "productName": null, "supplierName": null}],
  "year2Seeds": [{"title": "...", "body": "...", "productName": null, "supplierName": null}]
}
Each array should have 2-4 items. Be specific and actionable. Never suggest pricing changes.`,
        messages: [{ role: "user", content: `Generate a debrief for this event:\n\n${contextLines}` }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text().catch(() => "");
      throw new Error("Claude API error: " + err);
    }
    const claudeData = await claudeResp.json() as any;
    const rawText = claudeData?.content?.[0]?.text || "{}";

    let parsed: any = {};
    try { parsed = JSON.parse(rawText); } catch { parsed = {}; }

    const batch = db.batch();
    const writeRec = (category: string, items: any[]) => {
      (items || []).forEach((item: any, i: number) => {
        const ref = db.collection(`venues/${venueId}/eventHistory/${eventId}/debriefRecommendations`).doc(`${category}_${i}`);
        batch.set(ref, {
          category,
          title: item.title || "",
          body: item.body || "",
          productName: item.productName || null,
          supplierName: item.supplierName || null,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    };
    writeRec("worked_well", parsed.workedWell || []);
    writeRec("improve", parsed.improve || []);
    writeRec("year2_seed", parsed.year2Seeds || []);
    await batch.commit();

    console.log("[api/writeFestivalDebrief] OK", { uid, venueId, eventId });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[api/writeFestivalDebrief] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
});

app.post("/send-failing-invoice", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const { venueId, supplierName, documentStorageRef, invoiceDocId } = req.body;
    if (!venueId || !supplierName) return res.status(400).json({ ok: false, error: "Missing required fields" });

    await verifyVenueMembership(uid, venueId);

    const db = admin.firestore();
    const apiKey = process.env.POSTMARK_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "Email service not configured" });

    // Download invoice image from Storage if a path was recorded
    const attachments: any[] = [];
    if (documentStorageRef) {
      try {
        const [imgBuffer] = await admin.storage().bucket().file(documentStorageRef).download();
        const fileName = String(documentStorageRef).split("/").pop() || "invoice.jpg";
        attachments.push({
          Name: fileName,
          Content: imgBuffer.toString("base64"),
          ContentType: "image/jpeg",
        });
      } catch (e: any) {
        console.warn("[send-failing-invoice] could not download invoice image", e?.message);
      }
    }

    const venueSnap = await db.doc(`venues/${venueId}`).get();
    const venueName = venueSnap.data()?.name || venueId;

    const emailBody: any = {
      From: "Hosti <reports@hosti.co.nz>",
      To: "support@hosti.co.nz",
      Subject: `Invoice extraction issue — ${supplierName} — ${venueName}`,
      HtmlBody: `
        <p>A venue manager has flagged recurring price extraction failures.</p>
        <ul>
          <li><strong>Venue:</strong> ${venueName}</li>
          <li><strong>Supplier:</strong> ${supplierName}</li>
          ${invoiceDocId ? `<li><strong>Invoice ID:</strong> ${invoiceDocId}</li>` : ""}
        </ul>
        <p>Please investigate the extraction failure for this supplier and update the parser as needed.</p>
      `,
      MessageStream: "outbound",
    };
    if (attachments.length > 0) emailBody.Attachments = attachments;

    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (!pmRes.ok) {
      const pmErr = await pmRes.text().catch(() => "(no body)");
      throw new Error(`Postmark error ${pmRes.status}: ${pmErr}`);
    }

    // Mark all unreported failures for this supplier as sent
    try {
      const failuresSnap = await db
        .collection(`venues/${venueId}/priceExtractionFailures`)
        .where("supplierName", "==", supplierName)
        .where("reportedToSupport", "==", false)
        .get();
      if (!failuresSnap.empty) {
        const batch = db.batch();
        failuresSnap.docs.forEach((d) => {
          batch.update(d.ref, {
            reportedToSupport: true,
            reportedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
      }
    } catch (e: any) {
      console.warn("[send-failing-invoice] could not mark failures as reported", e?.message);
    }

    console.log("[send-failing-invoice] sent for venue", venueId, "supplier", supplierName);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[send-failing-invoice] error", e?.message);
    res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
});

// ── POST /supplier-register ──────────────────────────────────────────────────
// Body: { companyName, contactName, email, phone, region, abn }
// Creates a pending supplier registration in Firestore and emails poni@hosti.co.nz
app.post("/supplier-register", async (req, res) => {
  try {
    const { companyName, contactName, email, phone, region, abn } = req.body || {};

    if (!companyName || !email) {
      res.status(400).json({ ok: false, error: "Company name and email are required." });
      return;
    }

    // Write registration to Firestore
    const regRef = await admin.firestore().collection("supplierRegistrations").add({
      companyName: companyName.trim(),
      contactName: contactName?.trim() ?? null,
      email: email.trim().toLowerCase(),
      phone: phone?.trim() ?? null,
      region: region?.trim() ?? null,
      abn: abn?.trim() ?? null,
      status: "pending",
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send notification email to poni@hosti.co.nz
    const gmailUser = process.env.GMAIL_SENDER_ADDRESS;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (gmailUser && gmailPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: gmailUser, pass: gmailPass },
        });

        await transporter.sendMail({
          from: `"Hosti Notifications" <${gmailUser}>`,
          to: "poni@hosti.co.nz",
          subject: `New Supplier Registration — ${companyName}`,
          text: [
            "A new supplier has registered on Hosti and is awaiting verification.",
            "",
            `Company:      ${companyName}`,
            `Contact:      ${contactName ?? "—"}`,
            `Email:        ${email}`,
            `Phone:        ${phone ?? "—"}`,
            `Region:       ${region ?? "—"}`,
            `ABN/NZBN:     ${abn ?? "—"}`,
            `Registration: ${regRef.id}`,
            "",
            "To activate this account:",
            "1. Create a Firebase Auth account for this supplier (email + password)",
            "2. Create /supplierAccounts/{supplierId} with their details",
            "3. Set supplierId on their /users/{uid} doc",
            "4. Email them their login credentials",
            "",
            "Hosti Admin",
          ].join("\n"),
        });
      } catch (emailErr: any) {
        // Non-fatal — registration is written to Firestore regardless
        console.error("[supplier-register] email failed:", emailErr?.message);
      }
    } else {
      console.log("[supplier-register] Gmail credentials not configured — skipping email. Registration ID:", regRef.id);
    }

    res.json({ ok: true, registrationId: regRef.id });
  } catch (e: any) {
    console.error("[supplier-register] error:", e?.message);
    res.status(500).json({ ok: false, error: "Registration failed. Please try again." });
  }
});

export const api = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120, secrets: ["ANTHROPIC_API_KEY", "POSTMARK_API_KEY"] })
  .https.onRequest(app);

// ── Shared invoice parsing helpers ───────────────────────────────────────────

function extractPo(text: string): string | null {
  const patterns = [
    /PO\s*(?:NO\.?|NUMBER|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
    /P\.?O\.?\s*(?:NO\.?|NUMBER|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }
  return null;
}

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /Invoice\s*(?:NO\.?|Number|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
    /TAX\s+INVOICE[^\n]*?\b([A-Z]{2,}-\d{3,})\b/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }
  const fallback = text.match(/\bINV[-\s]?\d{3,}\b/i);
  if (fallback?.[0]) return fallback[0].toUpperCase().slice(0, 64);
  return null;
}

function extractDeliveryDate(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const datePatterns = [/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/, /\b(\d{4}-\d{2}-\d{2})\b/];
  for (const raw of lines) {
    const lower = raw.toLowerCase();
    if (!lower.includes("delivery") && !lower.includes("date") && !lower.includes("invoice")) continue;
    for (const rx of datePatterns) {
      const m = raw.match(rx);
      if (m?.[1]) return m[1].slice(0, 32);
    }
  }
  for (const raw of lines) {
    for (const rx of datePatterns) {
      const m = raw.match(rx);
      if (m?.[1]) return m[1].slice(0, 32);
    }
  }
  return null;
}

function guessSupplierName(text: string): string | null {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (const raw of lines.slice(0, 12)) {
    let line = raw;
    const idx = line.toLowerCase().indexOf("tax invoice");
    if (idx > 0) line = line.slice(0, idx).trim();
    const lower = line.toLowerCase();
    if (!line) continue;
    if (lower.includes("invoice") || lower.includes("statement")) continue;
    if (lower.includes("po #") || lower.includes("item qty")) continue;
    if (lower.includes("subtotal") || lower.includes("gst") || lower.includes("total (incl")) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (line.length >= 3 && line.length <= 64) candidates.push(line);
  }
  const preferred = candidates.find((c) =>
    /(foods|foodservice|distributors|limited|ltd|wholesale|suppl|nz)\b/i.test(c)
  );
  return preferred ?? candidates[0] ?? null;
}

function extractLinesFromText(text: string): Array<{ name: string; qty: number; unitPrice?: number }> {
  const out: Array<{ name: string; qty: number; unitPrice?: number }> = [];
  const lower = text.toLowerCase();
  const tableStart = lower.indexOf("item");
  const subtotalIndex = lower.indexOf("subtotal");
  const start = tableStart >= 0 ? tableStart : 0;
  const end = subtotalIndex > start ? subtotalIndex : Math.min(text.length, start + 2000);
  const block = text.slice(start, end);

  const rowRegex = /([A-Za-z0-9()/%., x+\-]{5,80}?)\s+(\d{1,4}(?:\.\d{1,2})?)\s+(\d{1,6}(?:\.\d{1,2})?)\s+(\d{1,8}(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(block))) {
    const name = m[1].replace(/\s{2,}/g, " ").trim();
    const qty = Number(m[2]);
    const unitPrice = Number(m[3]);
    if (!name || name.length < 3 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    out.push({ name, qty, unitPrice });
    if (out.length >= 40) break;
  }

  if (!out.length) {
    const lines = block.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const raw of lines) {
      const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
      const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
      const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
      const price = priceMatch ? Number(priceMatch[1]) : NaN;
      if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
        const name = raw.replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "").trim();
        if (name.length >= 3) out.push({ name, qty, unitPrice: price });
      }
      if (out.length >= 40) break;
    }
  }
  return out;
}

function parseCsvText(text: string): Array<{ name: string; qty: number; unitPrice?: number; code?: string }> {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Detect header row
  const headerRaw = lines[0].toLowerCase();
  const cols = headerRaw.split(',').map((s) => s.trim());

  // Map common column names
  const nameIdx = cols.findIndex((c) => /name|description|product|item/i.test(c));
  const qtyIdx = cols.findIndex((c) => /qty|quantity|units|count/i.test(c));
  const priceIdx = cols.findIndex((c) => /price|cost|unit.?price|rate/i.test(c));
  const codeIdx = cols.findIndex((c) => /code|sku|barcode/i.test(c));

  // If we can identify columns, use them
  if (nameIdx >= 0 && qtyIdx >= 0) {
    const out: Array<{ name: string; qty: number; unitPrice?: number; code?: string }> = [];
    for (const raw of lines.slice(1)) {
      const parts = raw.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const name = parts[nameIdx] || '';
      const qty = Number(parts[qtyIdx]);
      const unitPrice = priceIdx >= 0 ? Number(parts[priceIdx]) : undefined;
      const code = codeIdx >= 0 ? parts[codeIdx] : undefined;
      if (!name || !Number.isFinite(qty) || qty <= 0) continue;
      out.push({ name, qty, unitPrice: (unitPrice && Number.isFinite(unitPrice)) ? unitPrice : undefined, code: code || undefined });
      if (out.length >= 200) break;
    }
    return out;
  }

  // Fallback: try to infer from raw data rows (name, qty, price)
  const out: Array<{ name: string; qty: number; unitPrice?: number }> = [];
  for (const raw of lines.slice(1)) {
    const parts = raw.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const name = parts[0];
    const qty = Number(parts[1]);
    const unitPrice = parts[2] ? Number(parts[2]) : undefined;
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, qty, unitPrice: (unitPrice && Number.isFinite(unitPrice)) ? unitPrice : undefined });
    if (out.length >= 200) break;
  }
  return out;
}

// ── Price change flags for manager review ─────────────────────────────────────
// Writes a significant price change (>= 5%) to venues/{venueId}/priceChangeFlags
// for manager review (acknowledge/dismiss via PriceChangeFlagsScreen).
async function flagPriceChangeToManager(
  db: FirebaseFirestore.Firestore,
  venueId: string,
  productId: string,
  productName: string,
  oldPrice: number,
  newPrice: number,
  changePercent: number,
  supplierName: string,
  invoiceId: string
): Promise<void> {
  await db.collection(`venues/${venueId}/priceChangeFlags`).add({
    productId,
    productName,
    oldPrice,
    newPrice,
    changePercent: Math.round(changePercent * 10) / 10,
    direction: newPrice > oldPrice ? "increase" : "decrease",
    supplierName,
    invoiceId,
    flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
    acknowledgedBy: null,
    acknowledgedAt: null,
    impactOnGP: null,
    note: null,
  });
}

// ── POST /process-invoices-csv ────────────────────────────────────────────────
// Body: { venueId, orderId, storagePath }
// Returns: { ok, invoice, lines, confidence, warnings }
app.post("/process-invoices-csv", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, storagePath } = req.body || {};
    if (!venueId || !storagePath) {
      res.status(400).json({ ok: false, error: "Missing venueId or storagePath" });
      return;
    }
    await verifyVenueMembership(uid, venueId);
    if (!storagePath.startsWith(`venues/${venueId}/`)) {
      res.status(403).json({ error: "Storage path not permitted for this venue." });
      return;
    }
    const lcCSV = await checkAiLimit(venueId, 'invoice_ocr');
    if (!lcCSV.allowed) { res.status(429).json(lcCSV.limitError); return; }

    // Download the file from Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storagePath).download();
    const csvText = fileBuffer.toString("utf-8");

    const lines = filterInvoiceLines(parseCsvText(csvText));
    const warnings: string[] = [];
    if (!lines.length) warnings.push("No line items could be parsed from this CSV.");

    const payload = {
      ok: true,
      invoice: { source: "csv", storagePath, poNumber: null },
      lines,
      confidence: lines.length > 0 ? 0.8 : 0.2,
      warnings,
    };

    trackAiCall(venueId, 'invoice_ocr').catch(() => {});
    console.log("[api/process-invoices-csv] OK", { uid, venueId, storagePath, linesCount: lines.length });
    res.json(payload);

    // Track price changes non-blocking
    trackPriceChanges({
      venueId,
      lines: lines.map((l: any) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, caseSize: l.caseSize ?? null })),
      supplierId: req.body?.supplierId || "",
      supplierName: req.body?.supplierName || "",
      invoiceId: `csv_${storagePath}`,
    }).then(result => {
      const db = admin.firestore();
      const significant = (result.changedLines || []).filter(c => Math.abs(c.changePercent) >= 5);
      return Promise.all(significant.map(c => flagPriceChangeToManager(
        db, venueId, c.productId, c.productName, c.oldPrice, c.newPrice, c.changePercent,
        req.body?.supplierName || "", `csv_${storagePath}`
      )));
    }).catch((e: any) => console.log("[api/process-invoices-csv] price tracking error", e?.message));

  } catch (e: any) {
    console.error("[api/process-invoices-csv] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "CSV processing failed" });
  }
});

// ── POST /process-invoices-pdf ────────────────────────────────────────────────
// Body: { venueId, orderId, storagePath }
// Returns: { ok, invoice, lines, confidence, warnings }
app.post("/process-invoices-pdf", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, storagePath } = req.body || {};
    if (!venueId || !storagePath) {
      res.status(400).json({ ok: false, error: "Missing venueId or storagePath" });
      return;
    }
    await verifyVenueMembership(uid, venueId);
    if (!storagePath.startsWith(`venues/${venueId}/`)) {
      res.status(403).json({ error: "Storage path not permitted for this venue." });
      return;
    }
    const lcPDF = await checkAiLimit(venueId, 'invoice_ocr');
    if (!lcPDF.allowed) { res.status(429).json(lcPDF.limitError); return; }

    // Download the PDF from Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storagePath).download();

    // Parse PDF text using pdf-parse
    const pdfParse = require("pdf-parse");
    const pdfData = await pdfParse(fileBuffer);
    const text = pdfData.text || "";

    // Detect scanned vs digital PDF
    const isScannedPdf = (t: string): boolean => {
      const wordCount = t.trim().split(/\s+/).length;
      const hasNumbers = /\d/.test(t);
      const hasLetters = /[a-zA-Z]/.test(t);
      return wordCount < 20 || (!hasNumbers && !hasLetters);
    };
    if (isScannedPdf(text)) {
      console.log("[api/process-invoices-pdf] Scanned PDF detected — returning guidance");
      res.json({
        ok: false,
        scannedPdf: true,
        message: "This PDF appears to be a scanned image rather than a digital document. For best results: take a photo using Invoice Scan, or ask your supplier for a digital PDF or CSV export.",
      });
      return;
    }
    console.log("[api/process-invoices-pdf] Digital PDF — processing as text");

    // Single comprehensive Claude extraction — supplier + customer + metadata + lines
    let invoiceData: CompleteInvoiceExtraction | null = null;
    let lines: any[] = [];
    try {
      invoiceData = await extractInvoiceComplete(text);
      lines = filterInvoiceLines(invoiceData.lines);
      if (!lines.length) throw new Error("No lines extracted");
    } catch (claudeErr: any) {
      console.log("[api/process-invoices-pdf] extractInvoiceComplete failed, using regex fallback", claudeErr?.message);
      lines = filterInvoiceLines(extractLinesFromText(text));
    }

    // Fall back to regex metadata extraction if Claude didn't get them
    const poNumber = invoiceData?.invoice.poNumber ?? extractPo(text);
    const invoiceNumber = invoiceData?.invoice.number ?? extractInvoiceNumber(text);
    const deliveryDate = invoiceData?.invoice.deliveryDate ?? extractDeliveryDate(text);
    const supplierName = invoiceData?.supplier.name ?? guessSupplierName(text);

    const warnings: string[] = [];
    if (!lines.length) warnings.push("No line items detected — please review manually.");

    const payload = {
      ok: true,
      invoice: {
        source: "pdf",
        storagePath,
        poNumber: poNumber ?? null,
        invoiceNumber: invoiceNumber ?? null,
        invoiceDate: invoiceData?.invoice.date ?? null,
        deliveryDate: deliveryDate ?? null,
        supplierName: supplierName ?? null,
        supplierPhone: invoiceData?.supplier.phone ?? null,
        supplierEmail: invoiceData?.supplier.email ?? null,
        supplierAddress: invoiceData?.supplier.address ?? null,
        supplierAccountNumber: invoiceData?.supplier.accountNumber ?? null,
        customerName: invoiceData?.customer.name ?? null,
        totalAmount: invoiceData?.invoice.total ?? null,
        gstAmount: invoiceData?.invoice.gst ?? null,
      },
      lines,
      confidence: lines.length > 0 ? 0.8 : 0.2,
      warnings,
    };

    trackAiCall(venueId, 'invoice_ocr').catch(() => {});
    console.log("[api/process-invoices-pdf] OK", { uid, venueId, storagePath, linesCount: lines.length, poNumber, supplierName });
    res.json(payload);

    // FIX 2: Find or create venue supplier from extracted details (non-blocking)
    let resolvedSupplierIdPdf: string = req.body?.supplierId || "";
    if (supplierName) {
      try {
        const db = admin.firestore();
        const suppSnap = await db.collection(`venues/${venueId}/suppliers`).get();
        const candNorm = normNameForMatch(supplierName);
        let matchedId: string | null = null;
        let bestScore = 0;
        for (const sd of suppSnap.docs) {
          const sn = normNameForMatch((sd.data() as any).name || "");
          if (sn === candNorm && sn.length > 0) { matchedId = sd.id; bestScore = 1.0; break; }
          const sc = tokenJaccardMatch(supplierName, (sd.data() as any).name || "");
          if (sc > bestScore) { bestScore = sc; matchedId = sd.id; }
        }
        if (matchedId && bestScore >= 0.85) {
          resolvedSupplierIdPdf = matchedId;
          const existingDoc = suppSnap.docs.find(d => d.id === matchedId);
          if (existingDoc) {
            const ex = existingDoc.data() as any;
            const upd: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
            if (!ex.phone && payload.invoice.supplierPhone) upd.phone = payload.invoice.supplierPhone;
            if (!ex.email && payload.invoice.supplierEmail) upd.email = payload.invoice.supplierEmail;
            if (!ex.address && payload.invoice.supplierAddress) upd.address = payload.invoice.supplierAddress;
            if (!ex.accountNumber && payload.invoice.supplierAccountNumber) upd.accountNumber = payload.invoice.supplierAccountNumber;
            if (Object.keys(upd).length > 1) await db.doc(`venues/${venueId}/suppliers/${matchedId}`).update(upd);
          }
        } else {
          const newSupRef = await db.collection(`venues/${venueId}/suppliers`).add({
            name: supplierName,
            phone: payload.invoice.supplierPhone || null,
            email: payload.invoice.supplierEmail || null,
            address: payload.invoice.supplierAddress || null,
            accountNumber: payload.invoice.supplierAccountNumber || null,
            isHoldingSupplier: false,
            source: "invoice-pdf",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          resolvedSupplierIdPdf = newSupRef.id;
        }
      } catch (e: any) {
        console.log("[api/process-invoices-pdf] supplier find/create error", e?.message);
      }
    }

    // Track price changes non-blocking
    const pdfInvoiceId = poNumber || `pdf_${storagePath}`;
    trackPriceChanges({
      venueId,
      lines: lines.map((l: any) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, caseSize: l.caseSize ?? null })),
      supplierId: resolvedSupplierIdPdf,
      supplierName: supplierName || req.body?.supplierName || "",
      invoiceId: pdfInvoiceId,
    }).then(result => {
      const db = admin.firestore();
      const significant = (result.changedLines || []).filter(c => Math.abs(c.changePercent) >= 5);
      return Promise.all(significant.map(c => flagPriceChangeToManager(
        db, venueId, c.productId, c.productName, c.oldPrice, c.newPrice, c.changePercent,
        supplierName || req.body?.supplierName || "", pdfInvoiceId
      )));
    }).catch((e: any) => console.log("[api/process-invoices-pdf] price tracking error", e?.message));

  } catch (e: any) {
    console.error("[api/process-invoices-pdf] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "PDF processing failed" });
  }
});

// ── POST /process-sales-pdf ──────────────────────────────────────────────────
// Body: { venueId, storagePath }
// Downloads PDF from Storage, extracts sales data via pdf-parse + Claude
app.post("/process-sales-pdf", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, storagePath } = req.body || {};
    if (!venueId || !storagePath) {
      res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return;
    }
    await verifyVenueMembership(uid, venueId);
    if (!storagePath.startsWith(`venues/${venueId}/`)) {
      res.status(403).json({ error: "Storage path not permitted" }); return;
    }

    const lc = await checkAiLimit(venueId, "sales_report");
    if (!lc.allowed) { res.status(429).json(lc.limitError); return; }

    // Download PDF from Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storagePath).download();

    // Extract text with pdf-parse
    let pdfText = "";
    try {
      const pdfParse = require("pdf-parse");
      const parsed = await pdfParse(fileBuffer);
      pdfText = parsed.text || "";
    } catch (e: any) {
      console.error("[process-sales-pdf] pdf-parse error:", e?.message);
    }

    if (!pdfText.trim()) {
      res.json({
        ok: true,
        source: "pdf",
        period: {},
        lines: [],
        warnings: ["Could not extract text from this PDF — it may be a scanned image. Export a CSV from your POS instead."],
      }); return;
    }

    // Send to Claude
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ ok: false, error: "AI not configured" }); return; }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{
          role: "user",
          content: `Extract all sales line items from this POS sales report. Return ONLY valid JSON, no other text:
{
  "period": { "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null" },
  "lines": [
    {
      "name": "product name",
      "sku": "sku or null",
      "barcode": "barcode or null",
      "qtySold": 12,
      "gross": 180.00,
      "net": 156.52,
      "tax": 23.48
    }
  ],
  "warnings": []
}
Rules: Include every product line. qtySold must be a positive number. gross/net/tax are numbers or null. Skip totals, subtotals, header rows, and category rows — only individual product lines. Extract period dates if visible.

Sales report text:
${pdfText.slice(0, 8000)}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error("[process-sales-pdf] Claude error:", err);
      res.status(500).json({ ok: false, error: "AI extraction failed" }); return;
    }

    const claudeData = await claudeRes.json() as any;
    const rawText: string = claudeData.content?.[0]?.text ?? "";

    let extracted: any = { period: {}, lines: [], warnings: [] };
    try {
      const cleaned = rawText.replace(/```json\n?|\n?```/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("[process-sales-pdf] JSON parse failed:", rawText.slice(0, 200));
      res.json({
        ok: true,
        source: "pdf",
        period: {},
        lines: [],
        warnings: ["Could not parse AI response — try a CSV export from your POS instead."],
      }); return;
    }

    const lines = (extracted.lines || []).filter((l: any) => l.name && Number(l.qtySold) > 0);
    trackAiCall(venueId, "sales_report").catch(() => {});

    res.json({
      ok: true,
      source: "pdf",
      period: extracted.period || {},
      lines,
      warnings: extracted.warnings || [],
    });
  } catch (e: any) {
    console.error("[process-sales-pdf]", e?.message);
    res.status(500).json({ ok: false, error: e?.message || "Sales PDF processing failed" });
  }
});

// ── POST /process-invoice-photo ──────────────────────────────────────────────
// Body: { venueId, storagePath }
// Downloads image from Storage, sends to Claude Vision, extracts invoice lines.
app.post("/process-invoice-photo", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, storagePath } = req.body || {};
    if (!venueId || !storagePath) {
      res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return;
    }
    await verifyVenueMembership(uid, venueId);
    if (!storagePath.startsWith(`venues/${venueId}/`)) {
      res.status(403).json({ error: "Storage path not permitted" }); return;
    }

    const lcPhoto = await checkAiLimit(venueId, "invoice_ocr");
    if (!lcPhoto.allowed) { res.status(429).json(lcPhoto.limitError); return; }

    // Download image from Storage
    const bucket = admin.storage().bucket();
    const [imageBuffer] = await bucket.file(storagePath).download();
    const base64Image = imageBuffer.toString("base64");

    const ext = storagePath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mediaType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ ok: false, error: "AI not configured" }); return; }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Image },
            },
            {
              type: "text",
              text: `Extract all invoice line items from this supplier invoice image. Return ONLY valid JSON in this exact format, no other text:
{
  "supplierName": "string or null",
  "invoiceNumber": "string or null",
  "poNumber": "string or null",
  "lines": [
    { "name": "product name", "qty": 1, "unitPrice": 10.00 }
  ]
}
Rules: Include every product line. qty must be a positive number. unitPrice is the per-unit cost excluding GST (null if not visible). Skip totals, subtotals, GST rows, and header rows. Only include actual product lines.`,
            },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("[process-invoice-photo] Claude error:", errText);
      res.status(500).json({ ok: false, error: "AI extraction failed" }); return;
    }

    const claudeData = await claudeRes.json() as any;
    const rawText: string = claudeData.content?.[0]?.text ?? "";

    let extracted: { supplierName?: string; invoiceNumber?: string; poNumber?: string; lines: any[] } = { lines: [] };
    try {
      const cleaned = rawText.replace(/```json\n?|\n?```/g, "").trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("[process-invoice-photo] JSON parse failed:", rawText.slice(0, 200));
      res.json({ ok: true, lines: [], invoice: { source: "photo", storagePath }, warnings: ["Could not parse AI response — please try a clearer photo"] });
      return;
    }

    const lines = (extracted.lines || []).filter((l: any) => l.name && Number(l.qty) > 0);
    const warnings: string[] = [];
    if (!lines.length) warnings.push("No product lines detected — try a clearer, well-lit photo of the invoice");

    trackAiCall(venueId, "invoice_ocr").catch(() => {});

    res.json({
      ok: true,
      invoice: {
        source: "photo",
        storagePath,
        supplierName: extracted.supplierName ?? null,
        invoiceNumber: extracted.invoiceNumber ?? null,
        poNumber: extracted.poNumber ?? null,
      },
      lines,
      warnings,
    });
  } catch (e: any) {
    console.error("[process-invoice-photo]", e?.message);
    res.status(500).json({ ok: false, error: e?.message || "Photo processing failed" });
  }
});

// ── POST /refine-prediction ───────────────────────────────────────────────────
// Body: { venueId, mathResults, eventDetails }
// Calls Claude to adjust market share splits within categories.
// Math category totals are preserved — only splits are adjusted.
app.post("/refine-prediction", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, mathResults, eventDetails } = req.body || {};
    if (!venueId || !Array.isArray(mathResults) || !eventDetails) {
      res.status(400).json({ ok: false, error: "Missing venueId, mathResults, or eventDetails" });
      return;
    }

    await verifyVenueMembership(uid, venueId);

    const lc = await checkAiLimit(venueId, "prediction_refinement");
    if (!lc.allowed) { res.status(429).json({ ok: false, ...lc.limitError }); return; }

    const db = admin.firestore();
    const { buildRefinementContext, buildRefinementPrompt } = require("./predictionRefinement");
    const context = await buildRefinementContext(venueId, eventDetails, mathResults, db);
    const prompt  = buildRefinementPrompt(context);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: "You are a beverage purchasing advisor specialising in NZ/AU festival operations. Return only valid JSON.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error("Claude API error: " + errText);
    }

    const aiData = await resp.json() as any;
    const rawText = aiData?.content?.[0]?.text || "{}";

    let refinement: any;
    try {
      const clean = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      refinement = JSON.parse(clean);
    } catch {
      res.status(500).json({
        ok: false,
        error: "Could not parse AI response",
        message: "AI refinement failed. Use the math baseline instead.",
      });
      return;
    }

    const meter = await trackAiCall(venueId, "prediction_refinement");
    console.log("[api/refine-prediction] ok", { uid, venueId, historyUsed: context.hasHistory, products: mathResults.length });
    res.json({ ok: true, refinement, historyUsed: context.hasHistory, meter });

  } catch (e: any) {
    console.error("[api/refine-prediction] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Refinement failed" });
  }
});

// ── POST /extract-festival-contract ──────────────────────────────────────────
// Body: { venueId, contractId, storageRef }
// Downloads PDF from Storage, extracts obligations via Claude, updates Firestore.
app.post("/extract-festival-contract", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, contractId, storageRef } = req.body || {};
    if (!venueId || !contractId || !storageRef) {
      res.status(400).json({ ok: false, error: "Missing venueId, contractId, or storageRef" });
      return;
    }

    const db = admin.firestore();

    // Verify caller is owner
    const memberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    const role = memberSnap.exists ? (memberSnap.data() as any)?.role : null;
    if (role !== "owner") {
      res.status(403).json({ ok: false, error: "Contracts are owner only" });
      return;
    }

    if (!storageRef.startsWith(`festival-contracts/${venueId}/`)) {
      res.status(400).json({ ok: false, error: "Invalid storageRef" }); return;
    }

    const lc = await checkAiLimit(venueId, "ai_insights");
    if (!lc.allowed) { res.status(429).json({ ok: false, ...lc.limitError }); return; }

    // Download PDF from Firebase Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storageRef).download();

    // Extract text with pdf-parse
    const pdfParse = require("pdf-parse");
    console.log('[contract-parse] fileBuffer type:', typeof fileBuffer, 'isBuffer:', Buffer.isBuffer(fileBuffer), 'length:', fileBuffer?.length);
    let pdfData: any;
    try {
      pdfData = await pdfParse(fileBuffer);
      console.log('[contract-parse] pdfParse ok, text length:', pdfData?.text?.length);
    } catch (e: any) {
      console.error('[contract-parse] pdfParse threw:', e?.message || e);
      throw e;
    }
    const rawText = (pdfData.text || "").trim();

    // Truncate to avoid token limits (~12k chars ≈ ~3k tokens)
    const text = rawText.length > 14000 ? rawText.slice(0, 14000) + "\n[truncated]" : rawText;

    if (text.length < 50) {
      await db.doc(`venues/${venueId}/contracts/${contractId}`).update({
        status: "review_needed",
        reviewNote: "Could not extract text from PDF. May be a scanned document.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ ok: false, scanned: true });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const systemPrompt =
      "You are extracting contract obligations from a hospitality supplier agreement for a festival operator. " +
      "Extract ONLY factual obligations — do not interpret or advise. Return JSON only, no other text.";

    const userPrompt =
      `Extract all obligations from this contract. Return as JSON:\n` +
      `{\n` +
      `  "supplierName": string,\n` +
      `  "contractPeriod": { "start": string, "end": string },\n` +
      `  "obligations": [\n` +
      `    {\n` +
      `      "type": "minimum_volume" | "exclusivity" | "display_requirement" | "activation" | "rebate" | "return_policy" | "other",\n` +
      `      "product": string | null,\n` +
      `      "requirement": string,\n` +
      `      "quantity": number | null,\n` +
      `      "unit": string | null,\n` +
      `      "zone": string | null,\n` +
      `      "financialImpact": string | null,\n` +
      `      "deadline": string | null\n` +
      `    }\n` +
      `  ],\n` +
      `  "rebates": [\n` +
      `    {\n` +
      `      "threshold": number,\n` +
      `      "thresholdUnit": string,\n` +
      `      "rebatePercent": number | null,\n` +
      `      "rebateAmount": number | null,\n` +
      `      "product": string | null\n` +
      `    }\n` +
      `  ],\n` +
      `  "returnConditions": string,\n` +
      `  "paymentTerms": string | null,\n` +
      `  "pricingTerms": [\n` +
      `    {\n` +
      `      "productName": "product name as written in contract",\n` +
      `      "agreedUnitPrice": number | null,\n` +
      `      "agreedCasePrice": number | null,\n` +
      `      "currency": "NZD",\n` +
      `      "gstExclusive": true,\n` +
      `      "validFrom": "YYYY-MM-DD or null",\n` +
      `      "validTo": "YYYY-MM-DD or null",\n` +
      `      "notes": "any pricing conditions or null"\n` +
      `    }\n` +
      `  ]\n` +
      `}\n\n` +
      `For pricingTerms: extract any fixed unit prices or case prices specified in this contract. ` +
      `These are prices the supplier has agreed to charge. If a price range is given, extract the maximum (ceiling) price. ` +
      `If prices are GST-inclusive set gstExclusive to false. ` +
      `If no pricing terms are specified return an empty array.\n\n` +
      `Contract text:\n${text}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error("Claude API error: " + errText);
    }

    const aiData = await resp.json() as any;
    const rawJson = aiData?.content?.[0]?.text || "{}";

    let extracted: any = {};
    try {
      // Strip markdown code fences if present
      const clean = rawJson.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      extracted = JSON.parse(clean);
    } catch {
      await db.doc(`venues/${venueId}/contracts/${contractId}`).update({
        status: "review_needed",
        reviewNote: "AI returned unexpected format. Please review manually.",
        rawExtraction: rawJson,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ ok: false, parseError: true });
      return;
    }

    const obligations: any[] = extracted.obligations || [];
    const rebates: any[] = extracted.rebates || [];
    const pricingTerms: any[] = extracted.pricingTerms || [];

    // Update contract document (owner-only collection)
    await db.doc(`venues/${venueId}/contracts/${contractId}`).update({
      supplierName:          extracted.supplierName || null,
      contractPeriod:        extracted.contractPeriod || null,
      extractedObligations:  obligations,
      rebates,
      pricingTerms,
      returnConditions:      extracted.returnConditions || null,
      paymentTerms:          extracted.paymentTerms || null,
      rawExtraction:         rawJson,
      status:                "extracted",
      updatedAt:             admin.firestore.FieldValue.serverTimestamp(),
    });

    // Write agreed prices to event/details.contractPricing keyed by supplierName (best-effort)
    if (pricingTerms.length > 0 && extracted.supplierName) {
      try {
        const supplierKey = extracted.supplierName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        await db.doc(`venues/${venueId}/event/details`).set({
          contractPricing: {
            [supplierKey]: {
              supplierName: extracted.supplierName,
              contractId,
              pricingTerms,
              extractedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
        }, { merge: true });
      } catch (e: any) {
        console.log("[extract-festival-contract] contractPricing write error", e?.message);
      }
    }

    // Write obligations to manager-visible collection (no financial details)
    const batch = db.batch();
    for (const obl of obligations) {
      const oblId = `${contractId}_${Math.random().toString(36).slice(2, 9)}`;
      const ref = db.doc(`venues/${venueId}/obligations/${oblId}`);
      batch.set(ref, {
        contractId,
        supplierName:    extracted.supplierName || null,
        type:            obl.type || "other",
        product:         obl.product || null,
        requirement:     obl.requirement || "",
        quantity:        obl.quantity || null,
        unit:            obl.unit || null,
        zone:            obl.zone || null,
        currentProgress: 0,
        status:          "not_started",
        createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    // Write contracted prices to venue products (best-effort — non-fatal)
    if (pricingTerms.length > 0) {
      try {
        const db2 = admin.firestore();
        const productsSnap = await db2.collection(`venues/${venueId}/products`).get();
        const productsBatch = db2.batch();
        let priceUpdates = 0;

        for (const pt of pricingTerms) {
          if (!pt.productName || pt.agreedUnitPrice == null) continue;
          const needle = (pt.productName as string).toLowerCase().trim();

          const match = productsSnap.docs.find(d => {
            const pName = ((d.data() as any).name || "").toLowerCase().trim();
            return pName === needle || pName.includes(needle) || needle.includes(pName);
          });

          if (match) {
            const currentCost = (match.data() as any).costPrice ?? null;
            const newCost = pt.gstExclusive === false
              ? Math.round((pt.agreedUnitPrice / 1.15) * 100) / 100
              : pt.agreedUnitPrice;

            productsBatch.update(match.ref, {
              costPrice: newCost,
              supplierPriceUpdated: true,
              supplierNewPrice: newCost,
              supplierPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              contractPriceLockedBy: contractId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            if (currentCost !== null && Math.abs(currentCost - newCost) > 0.01) {
              await db2.collection(`venues/${venueId}/priceChangeFlags`).add({
                productName: (match.data() as any).name,
                supplierName: extracted.supplierName || null,
                oldPrice: currentCost,
                newPrice: newCost,
                detectedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: "pending",
                source: "contract-extraction",
                contractId,
              });
            }
            priceUpdates++;
          } else {
            // Product not in inventory — create it
            const newProductRef = db2.collection(`venues/${venueId}/products`).doc();
            const guessedCategory = (() => {
              const n = (pt.productName as string).toLowerCase();
              if (n.includes("beer") || n.includes("lager") || n.includes("ale")) return "Beer";
              if (n.includes("wine") || n.includes("sauvignon") || n.includes("pinot") || n.includes("chardonnay")) return "Wine";
              if (n.includes("spirit") || n.includes("vodka") || n.includes("gin") || n.includes("rum") || n.includes("whisky") || n.includes("tequila")) return "Spirits";
              if (n.includes("rtd") || n.includes("seltzer") || n.includes("cider")) return "RTD";
              if (n.includes("water") || n.includes("juice") || n.includes("soft") || n.includes("cola")) return "Non-Alcoholic";
              return null;
            })();
            const newCost = pt.agreedUnitPrice != null
              ? (pt.gstExclusive === false
                  ? Math.round((pt.agreedUnitPrice / 1.15) * 100) / 100
                  : pt.agreedUnitPrice)
              : null;
            productsBatch.set(newProductRef, {
              name: pt.productName,
              costPrice: newCost,
              supplierName: extracted.supplierName || "Unassigned",
              category: guessedCategory,
              unit: null,
              packSize: null,
              parLevel: null,
              inductionStatus: "complete",
              inductionSource: "contract-extraction",
              contractPriceLockedBy: contractId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            priceUpdates++;
            console.log(`[extract-festival-contract] created new product: ${pt.productName}`);
          }
        }

        await productsBatch.commit();
        console.log(`[extract-festival-contract] updated costPrice for ${priceUpdates} products from contract pricing`);
      } catch (e: any) {
        console.log("[extract-festival-contract] product price update failed:", e?.message);
      }
    }

    console.log(`[extract-festival-contract] ok: venueId=${venueId}, contractId=${contractId}, obligations=${obligations.length}`);
    res.json({ ok: true, obligationsCount: obligations.length, supplierName: extracted.supplierName });

  } catch (e: any) {
    console.error("[extract-festival-contract] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Extraction failed" });
  }
});

// ── POST /extract-festival-rider ──────────────────────────────────────────────
// Body: { venueId, riderId, storageRef }
// Downloads rider PDF, extracts requirements via Claude, updates Firestore.
app.post("/extract-festival-rider", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }

    const { venueId, riderId, storageRef } = req.body || {};
    if (!venueId || !riderId || !storageRef) {
      res.status(400).json({ ok: false, error: "Missing venueId, riderId, or storageRef" });
      return;
    }

    const db = admin.firestore();

    const riderMemberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    const riderRole = riderMemberSnap.data()?.role;
    if (riderRole !== 'owner' && riderRole !== 'manager') {
      res.status(403).json({ ok: false, error: "Insufficient role for rider extraction." });
      return;
    }

    if (!storageRef.startsWith(`festival-riders/${venueId}/`)) {
      res.status(400).json({ ok: false, error: "Invalid storageRef" }); return;
    }

    const lc = await checkAiLimit(venueId, "ai_insights");
    if (!lc.allowed) { res.status(429).json({ ok: false, ...lc.limitError }); return; }

    // Download PDF
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storageRef).download();

    const pdfParse = require("pdf-parse");
    const pdfData = await pdfParse(fileBuffer);
    const text = ((pdfData.text || "").trim()).slice(0, 10000);

    if (text.length < 20) {
      await db.doc(`venues/${venueId}/riders/${riderId}`).update({
        status: "review_needed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ ok: false, scanned: true });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const systemPrompt =
      "Extract alcohol and beverage requirements from this artist rider. Return JSON only.";

    const userPrompt =
      `Extract requirements:\n{\n` +
      `  "artistName": string,\n` +
      `  "setTime": string | null,\n` +
      `  "dressingRoom": [{ "product": string, "quantity": number, "unit": string, "temperature": string | null, "notes": string | null }],\n` +
      `  "stageArea": [{ "product": string, "quantity": number, "unit": string, "notes": string | null }],\n` +
      `  "deliveryTime": string | null,\n` +
      `  "deliveryLocation": string | null,\n` +
      `  "specialRequests": string | null\n` +
      `}\n\nRider text:\n${text}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) throw new Error("Claude API error");
    const aiData = await resp.json() as any;
    const rawJson = aiData?.content?.[0]?.text || "{}";

    let extracted: any = {};
    try {
      const clean = rawJson.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      extracted = JSON.parse(clean);
    } catch {
      await db.doc(`venues/${venueId}/riders/${riderId}`).update({
        status: "review_needed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ ok: false, parseError: true });
      return;
    }

    await db.doc(`venues/${venueId}/riders/${riderId}`).update({
      artistName:       extracted.artistName || null,
      setTime:          extracted.setTime || null,
      deliveryTime:     extracted.deliveryTime || null,
      deliveryLocation: extracted.deliveryLocation || null,
      dressingRoom:     extracted.dressingRoom || [],
      stageArea:        extracted.stageArea || [],
      specialRequests:  extracted.specialRequests || null,
      status:           "pending",
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[extract-festival-rider] ok: venueId=${venueId}, riderId=${riderId}, artist=${extracted.artistName}`);
    res.json({ ok: true, artistName: extracted.artistName });

  } catch (e: any) {
    console.error("[extract-festival-rider] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Extraction failed" });
  }
});

// ── scheduleSlowMoversCheck ───────────────────────────────────────────────────
// Runs every Monday at 8am Pacific/Auckland time.
// Flags products with no movement in 30+ days and count > 0.
// Writes results to venues/{venueId}/slowMovers.
export const scheduleSlowMoversCheck = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 540 })
  .pubsub.schedule("every monday 08:00")
  .timeZone("Pacific/Auckland")
  .onRun(async () => {
    const db = admin.firestore();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let venuesSnap: any;
    try {
      venuesSnap = await db.collection("venues").get();
    } catch (e) {
      console.error("[scheduleSlowMoversCheck] failed to query venues:", e);
      return null;
    }

    const results = await Promise.allSettled(
      venuesSnap.docs.map(async (venueDoc: any) => {
        const venueId: string = venueDoc.id;
        const slowMovers: any[] = [];

        try {
          const deptsSnap = await db.collection(`venues/${venueId}/departments`).limit(30).get();

          for (const deptDoc of deptsSnap.docs) {
            const deptName: string = deptDoc.data().name || deptDoc.id;
            const areasSnap = await db
              .collection(`venues/${venueId}/departments/${deptDoc.id}/areas`)
              .limit(50)
              .get();

            for (const areaDoc of areasSnap.docs) {
              const areaName: string = areaDoc.data().name || areaDoc.id;
              const itemsSnap = await db
                .collection(`venues/${venueId}/departments/${deptDoc.id}/areas/${areaDoc.id}/items`)
                .limit(200)
                .get();

              for (const itemDoc of itemsSnap.docs) {
                const item = itemDoc.data();
                const lastCount = typeof item.lastCount === "number" ? item.lastCount : null;
                if (lastCount === null || lastCount <= 0) continue;

                const lastCountAt: Date | null = item.lastCountAt?.toDate?.() ?? null;
                if (!lastCountAt || lastCountAt >= thirtyDaysAgo) continue;

                const daysSinceMovement = Math.floor(
                  (Date.now() - lastCountAt.getTime()) / (1000 * 60 * 60 * 24)
                );

                const confirmedCount = typeof item.confirmedCount === "number" ? item.confirmedCount : null;
                const confirmedCountAt: Date | null = item.confirmedCountAt?.toDate?.() ?? null;
                let velocityPerWeek = 0;
                if (confirmedCount !== null && confirmedCount > lastCount && confirmedCountAt) {
                  const daysBetween = Math.max(
                    1,
                    (lastCountAt.getTime() - confirmedCountAt.getTime()) / (1000 * 60 * 60 * 24)
                  );
                  velocityPerWeek = ((confirmedCount - lastCount) / daysBetween) * 7;
                }

                const projectedSellThrough = velocityPerWeek > 0
                  ? Math.round((lastCount / velocityPerWeek) * 7)
                  : null;

                let expiryRisk = false;
                try {
                  if (item.expiryDate) {
                    const expiryDate: Date | null =
                      item.expiryDate?.toDate?.() ??
                      (typeof item.expiryDate === "string" ? new Date(item.expiryDate) : null);
                    if (expiryDate) {
                      const daysUntilExpiry = Math.floor(
                        (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                      );
                      if (daysUntilExpiry > 0 && (projectedSellThrough === null || projectedSellThrough > daysUntilExpiry)) {
                        expiryRisk = true;
                      }
                    }
                  }
                } catch {}

                if (slowMovers.length >= 200) break;
                slowMovers.push({
                  productId: itemDoc.id,
                  productName: item.name || itemDoc.id,
                  areaId: areaDoc.id,
                  areaName,
                  deptId: deptDoc.id,
                  deptName,
                  currentCount: lastCount,
                  costPrice: typeof item.costPrice === "number" ? item.costPrice : null,
                  lastMovementAt: lastCountAt.toISOString(),
                  daysSinceMovement,
                  velocityPerWeek: Math.round(velocityPerWeek * 100) / 100,
                  expiryRisk,
                  projectedSellThrough,
                  flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }
              if (slowMovers.length >= 200) break;
            }
            if (slowMovers.length >= 200) break;
          }
        } catch (e: any) {
          console.error(`[scheduleSlowMoversCheck] scan error for venue=${venueId}:`, e?.message);
          return;
        }

        try {
          const existingSnap = await db.collection(`venues/${venueId}/slowMovers`).limit(300).get();

          if (existingSnap.docs.length > 0) {
            const delBatch = db.batch();
            existingSnap.docs.forEach((d: any) => delBatch.delete(d.ref));
            await delBatch.commit();
          }

          if (slowMovers.length > 0) {
            const writeBatch = db.batch();
            slowMovers.forEach((sm) => {
              const ref = db.doc(`venues/${venueId}/slowMovers/${sm.productId}`);
              writeBatch.set(ref, sm);
            });
            await writeBatch.commit();
          }

          console.log(`[scheduleSlowMoversCheck] venue=${venueId}: ${slowMovers.length} slow movers written`);
        } catch (e: any) {
          console.error(`[scheduleSlowMoversCheck] write error for venue=${venueId}:`, e?.message);
        }
      })
    );

    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length > 0) {
      console.error(`[scheduleSlowMoversCheck] ${failed.length}/${results.length} venue(s) failed`);
    }
    return null;
  });
