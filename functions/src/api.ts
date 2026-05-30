import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
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
  | 'suggest_orders' | 'variance_explain' | 'budget_suggest' | 'photo_count';

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
  },
  core: {
    total: 200, invoice_ocr: 30, product_photo: 30, shelf_scan: 10,
    stocktake_photo: 20, sales_report: 5, izzy: 100, suitee: 30,
    ai_insights: 8, suggest_orders: 15, variance_explain: 8,
  },
  core_plus: {
    total: 500, invoice_ocr: 80, product_photo: 100, shelf_scan: 30,
    stocktake_photo: 60, sales_report: 15, izzy: 300, suitee: 100,
    ai_insights: 20, suggest_orders: 40, variance_explain: 20,
  },
};

const FEATURE_LABELS: Record<string, string> = {
  invoice_ocr: 'invoice scanning', product_photo: 'product photos',
  shelf_scan: 'shelf scanning', stocktake_photo: 'stocktake import',
  sales_report: 'sales report import', izzy: 'Izzy questions',
  suitee: 'Suitee queries', ai_insights: 'AI insights',
  suggest_orders: 'order suggestions', variance_explain: 'variance explanations',
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
      model: "claude-sonnet-4-20250514",
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
          model: "claude-sonnet-4-20250514",
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
          model: "claude-sonnet-4-20250514",
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
// Body: { venueId, imageBase64, productHint?, unit? }
// Returns: { estimatedCount, confidence, reasoning, productName?, suggestions }
app.post("/photo-count", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, imageBase64, productHint, unit } = req.body || {};
    if (!venueId || !imageBase64) { res.status(400).json({ ok: false, error: "Missing venueId or imageBase64" }); return; }
    await verifyVenueMembership(uid, venueId);
    const lcPC = await checkAiLimit(venueId, 'stocktake_photo');
    if (!lcPC.allowed) { res.status(429).json(lcPC.limitError); return; }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const systemPrompt = [
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
        model: "claude-opus-4-6",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [{
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
          }, {
            type: "text",
            text: productHint ? "Count the " + productHint + " visible in this image." : "Count the stock items visible in this image.",
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

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

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
      const venueSnap = await db.doc(`venues/${venueId}`).get();
      const ownerUid: string | null = venueSnap.exists ? (venueSnap.data() as any)?.ownerUid ?? null : null;

      if (ownerUid === uid) {
        // Owner — delete everything under this venue
        await deleteVenueAllData(db, venueId);
      } else {
        // Member — remove from members subcollection only
        await db.doc(`venues/${venueId}/members/${uid}`).delete().catch(() => {});
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

async function deleteVenueAllData(db: admin.firestore.Firestore, venueId: string): Promise<void> {
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

  await admin.firestore().doc(`venues/${venueId}/settings/config`).delete().catch(() => {});
  await admin.firestore().doc(`venues/${venueId}/settings/theme`).delete().catch(() => {});
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

    // ── Gather venue context ──────────────────────────────────────────────────

    // Products
    let products: any[] = [];
    try {
      const snap = await db.collection(`venues/${venueId}/products`).limit(200).get();
      products = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || d.id,
          costPrice: typeof data.costPrice === "number" ? data.costPrice : null,
          parLevel: typeof data.parLevel === "number" ? data.parLevel : null,
          lastCountAt: data.lastCountAt?.toDate?.()?.toISOString() || null,
        };
      });
    } catch {}

    // Suppliers
    let supplierNames: string[] = [];
    try {
      const snap = await db.collection(`venues/${venueId}/suppliers`).get();
      supplierNames = snap.docs
        .filter(d => !d.data().isHoldingSupplier)
        .map(d => d.data().name || d.id);
    } catch {}

    // FIX 7: Per-product supplier intelligence for top products
    const productSupplierLines: string[] = [];
    try {
      const topByValue = [...products]
        .filter(p => p.costPrice != null)
        .sort((a, b) => (b.costPrice || 0) - (a.costPrice || 0))
        .slice(0, 20);
      for (const p of topByValue) {
        const linksSnap = await db.collection(`venues/${venueId}/products/${p.id}/suppliers`).limit(10).get();
        if (linksSnap.empty) continue;
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

    // Variance data — traverse departments → areas → items (same logic as briefing service)
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

    try {
      const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
      for (const deptDoc of deptsSnap.docs) {
        const deptData = deptDoc.data();
        const deptName: string = (deptData.name as string) || deptDoc.id;
        const totalCycles: number = typeof deptData.totalCyclesCompleted === "number" ? deptData.totalCyclesCompleted : 0;
        const lastCycleStr: string | null = deptData.lastCycleAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || null;

        const areasSnap = await db.collection(`venues/${venueId}/departments/${deptDoc.id}/areas`).get();
        let deptAreasTotal = 0, deptAreasCompleted = 0, deptActive = false;
        for (const areaDoc of areasSnap.docs) {
          deptAreasTotal++;
          const aData = areaDoc.data();
          if (aData.completedAt) deptAreasCompleted++;
          else if (aData.startedAt) deptActive = true;

          const areaName: string = (aData.name as string) || areaDoc.id;
          const itemsSnap = await db.collection(`venues/${venueId}/departments/${deptDoc.id}/areas/${areaDoc.id}/items`).get();
          for (const itemDoc of itemsSnap.docs) {
            const d = itemDoc.data();
            const lastCount = typeof d.lastCount === "number" ? d.lastCount : null;
            const confirmedCount = typeof d.confirmedCount === "number" ? d.confirmedCount : null;
            const parLevel = typeof d.parLevel === "number" ? d.parLevel : null;
            const costPrice = typeof d.costPrice === "number" ? d.costPrice : null;
            const name: string = (d.name as string) || itemDoc.id;

            // Stock holding value from latest known count
            const holdingCount = lastCount ?? confirmedCount ?? 0;
            if (costPrice) stockHoldingValue += holdingCount * costPrice;

            // Count data check — survives reset (lastCount restored from confirmedCount after reset)
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

        // Collect per-department context for Suitee
        const activeFlag = deptActive ? " (in progress)" : deptAreasCompleted === deptAreasTotal && deptAreasTotal > 0 ? " (complete)" : "";
        deptContextLines.push(
          `  ${deptName}: ${totalCycles} cycle${totalCycles !== 1 ? "s" : ""} completed, last ${lastCycleStr ?? "never"}, areas ${deptAreasCompleted}/${deptAreasTotal}${activeFlag}`
        );
      }
    } catch {}

    if (!hasCountData) {
      res.json({ ok: true, answer: "I don't have any stocktake data yet. Complete your first stocktake and I'll be able to answer questions about your venue." });
      return;
    }

    // Read last 6 snapshots per department for historical context
    const snapshotContextLines: string[] = [];
    try {
      const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
      for (const deptDoc of deptsSnap.docs) {
        const histSnap = await db
          .collection(`venues/${venueId}/departments/${deptDoc.id}/snapshots`)
          .orderBy('completedAt', 'desc')
          .limit(6)
          .get();
        if (histSnap.empty) continue;

        const snapDocs = histSnap.docs.map(d => d.data() as any);
        const latest = snapDocs[0];
        const s = latest.summary || {};
        const dc = latest.dataCompleteness || {};

        const deptSnapLines = [
          `  ${latest.departmentName}: ${snapDocs.length} cycle(s) on record, Tier ${dc.tier ?? 1}/4`,
          `    Latest (Cycle ${latest.cycleNumber}): Items ${s.totalItemsCounted}, below PAR: ${s.itemsBelowPAR}, variance qty: ${s.totalVarianceQty}`,
          s.totalVarianceDollars != null ? `    Latest variance value: $${(s.totalVarianceDollars as number).toFixed(2)}` : '    No cost prices set',
          s.totalStockValue != null ? `    Latest stock value: $${(s.totalStockValue as number).toFixed(2)}` : null,
          dc.hasInvoices ? '    Has invoice data.' : '    No invoice data for this cycle.',
        ].filter(Boolean) as string[];
        snapshotContextLines.push(...deptSnapLines);

        // Findings from latest cycle
        const findings = latest.findings || {};
        if ((findings.likelyMissingInvoices || []).length > 0) {
          snapshotContextLines.push(`    Missing invoices: ${findings.likelyMissingInvoices.map((f: any) => `${f.productName} +${f.unexplainedGainQty}`).join(', ')}`);
        }
        if ((findings.poDiscrepancies || []).length > 0) {
          snapshotContextLines.push(`    PO shortfalls: ${findings.poDiscrepancies.map((f: any) => `${f.productName} (ordered ${f.orderedQty}, got ${f.receivedQty})`).join(', ')}`);
        }

        // Historical trend: stock value and variance across last N cycles
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
      }
    } catch {}

    allShortages.sort((a, b) => b.dollarVariance - a.dollarVariance);
    allExcesses.sort((a, b) => b.dollarVariance - a.dollarVariance);

    // Slow movers — products not counted in 30+ days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const slowMovers = products
      .filter(p => !p.lastCountAt || new Date(p.lastCountAt).getTime() < thirtyDaysAgo)
      .slice(0, 10);

    // Recent orders
    let recentOrders: { supplierName: string; status: string; totalValue: number | null; createdAt: string | null }[] = [];
    try {
      const ordersSnap = await db.collection(`venues/${venueId}/orders`).limit(10).get();
      recentOrders = ordersSnap.docs.map(d => {
        const od = d.data();
        return {
          supplierName: (od.supplierName as string) || (od.supplierId as string) || "Unknown",
          status: (od.status as string) || "unknown",
          totalValue: typeof od.totalValue === "number" ? od.totalValue : null,
          createdAt: od.createdAt?.toDate?.()?.toISOString()?.slice(0, 10) || null,
        };
      });
    } catch {}

    // Sales data
    let salesSummary = "";
    try {
      const salesSnap = await db.collection(`venues/${venueId}/salesReports`).limit(3).get();
      if (!salesSnap.empty) {
        salesSummary = salesSnap.docs.map(d => JSON.stringify(d.data())).join("\n");
      }
    } catch {}

    // Tracked slow movers from slowMovers collection
    const trackedSlowMoverLines: string[] = [];
    try {
      const smSnap = await db.collection(`venues/${venueId}/slowMovers`).limit(20).get();
      if (!smSnap.empty) {
        const smList = smSnap.docs.map(d => d.data() as any).filter((sm: any) => {
          if (!sm.dismissedUntil) return true;
          const du: Date | null = sm.dismissedUntil?.toDate?.() ?? null;
          return !du || du < new Date();
        });
        if (smList.length > 0) {
          const totalValue = smList.reduce((sum: number, sm: any) => sum + ((sm.costPrice || 0) * (sm.currentCount || 0)), 0);
          trackedSlowMoverLines.push(`SLOW MOVING STOCK (30+ days no movement): ${smList.length} lines, $${totalValue.toFixed(2)} total value`);
          smList.slice(0, 10).forEach((sm: any) => {
            trackedSlowMoverLines.push(
              `  - ${sm.productName}: ${sm.currentCount} on hand, ${sm.daysSinceMovement} days idle${sm.expiryRisk ? " ⚠ expiry risk" : ""}`
            );
          });
          const top = [...smList].sort((a: any, b: any) => b.daysSinceMovement - a.daysSinceMovement)[0];
          if (top) trackedSlowMoverLines.push(`  Slowest: ${top.productName} — ${top.daysSinceMovement} days`);
        }
      }
    } catch (e: any) {
      console.log("[api/suitee] slow movers query error", e?.message);
    }

    // Price change data (last 90 days)
    const priceChangeLines: string[] = [];
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const changedSnap = await db.collection(`venues/${venueId}/products`)
        .where("priceChanged", "==", true)
        .limit(10)
        .get();

      if (!changedSnap.empty) {
        const supplierIncreases: Record<string, number> = {};
        const recentChanges: { productName: string; oldPrice: number; newPrice: number; changePercent: number; direction: string; supplierName: string; date: Date | null }[] = [];

        for (const prodDoc of changedSnap.docs) {
          try {
            const histSnap = await db.collection(`venues/${venueId}/products/${prodDoc.id}/priceHistory`)
              .orderBy("date", "desc")
              .limit(3)
              .get();
            for (const h of histSnap.docs) {
              const hd = h.data() as any;
              const hDate: Date | null = hd.date?.toDate ? hd.date.toDate() : null;
              if (hDate && hDate >= ninetyDaysAgo) {
                recentChanges.push({
                  productName: prodDoc.data().name || prodDoc.id,
                  oldPrice: hd.oldPrice ?? 0,
                  newPrice: hd.newPrice ?? 0,
                  changePercent: hd.changePercent ?? 0,
                  direction: hd.direction || "increase",
                  supplierName: hd.supplierName || "Unknown",
                  date: hDate,
                });
                if (hd.direction === "increase" && hd.supplierName) {
                  supplierIncreases[hd.supplierName] = (supplierIncreases[hd.supplierName] || 0) + 1;
                }
              }
            }
          } catch {}
        }

        if (recentChanges.length > 0) {
          const topSupplier = Object.entries(supplierIncreases).sort((a, b) => b[1] - a[1])[0];
          priceChangeLines.push(`PRICE CHANGES (last 90 days): ${recentChanges.length} detected`);
          recentChanges.slice(0, 8).forEach(c => {
            const sign = c.changePercent >= 0 ? "+" : "";
            const dateStr = c.date ? c.date.toISOString().slice(0, 10) : "–";
            priceChangeLines.push(
              `  - ${c.productName}: $${c.oldPrice.toFixed(2)} → $${c.newPrice.toFixed(2)} (${sign}${c.changePercent.toFixed(1)}%) from ${c.supplierName} on ${dateStr}`
            );
          });
          if (topSupplier) {
            priceChangeLines.push(`  Supplier with most increases: ${topSupplier[0]} (${topSupplier[1]} increases)`);
          }
        }
      }
    } catch (e: any) {
      console.log("[api/suitee] price change query error", e?.message);
    }

    // Invoice spend per supplier (last 90 days)
    const invoiceSpendLines: string[] = [];
    try {
      const invNinetyDaysAgo = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      );
      const invoicesSnap = await db.collection(`venues/${venueId}/invoices`)
        .where("invoiceDateTimestamp", ">=", invNinetyDaysAgo)
        .limit(200)
        .get();
      const supplierSpend: Record<string, { name: string; totalSpend: number; invoiceCount: number; lastInvoiceDate: string }> = {};
      for (const invDoc of invoicesSnap.docs) {
        const d = invDoc.data() as any;
        const sid = d.supplierId || "unknown";
        if (!supplierSpend[sid]) {
          supplierSpend[sid] = { name: d.supplierName || "Unknown", totalSpend: 0, invoiceCount: 0, lastInvoiceDate: "" };
        }
        supplierSpend[sid].totalSpend += typeof d.totalAmount === "number" ? d.totalAmount : 0;
        supplierSpend[sid].invoiceCount++;
        if (d.invoiceDate && d.invoiceDate > supplierSpend[sid].lastInvoiceDate) {
          supplierSpend[sid].lastInvoiceDate = d.invoiceDate;
        }
      }
      const spendEntries = Object.values(supplierSpend)
        .filter(s => s.totalSpend > 0)
        .sort((a, b) => b.totalSpend - a.totalSpend);
      if (spendEntries.length > 0) {
        invoiceSpendLines.push(`SUPPLIER SPEND (last 90 days, from scanned invoices):`);
        spendEntries.forEach(s => {
          invoiceSpendLines.push(
            `  - ${s.name}: $${s.totalSpend.toFixed(2)} across ${s.invoiceCount} invoice${s.invoiceCount !== 1 ? "s" : ""}${s.lastInvoiceDate ? `, last invoice ${s.lastInvoiceDate}` : ""}`
          );
        });
      }
    } catch (e: any) {
      console.log("[api/suitee] invoice spend query error", e?.message);
    }

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
      `SUPPLIERS: ${supplierNames.join(", ") || "None"}`,
    ];

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
      lines.push("", "RECENT ORDERS:");
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

    if (invoiceSpendLines.length > 0) {
      lines.push("", ...invoiceSpendLines);
    }

    if (snapshotContextLines.length > 0) {
      lines.push("", "CYCLE SNAPSHOT INTELLIGENCE (per department, from last completed snapshot):");
      lines.push(...snapshotContextLines);
    }

    // FIX 8: Velocity performance context derived from snapshot items (pure math, no AI)
    const velocityLines: string[] = [];
    try {
      // Gather all snapshot items across all departments (latest snapshot per dept)
      const productCycles = new Map<string, { velocities: number[]; lastStock: number; costPrice: number | null; parLevel: number | null }>();

      const velDeptsSnap = await db.collection(`venues/${venueId}/departments`).get();
      for (const deptDoc of velDeptsSnap.docs) {
        const snapHistSnap = await db
          .collection(`venues/${venueId}/departments/${deptDoc.id}/snapshots`)
          .orderBy('completedAt', 'desc')
          .limit(6)
          .get();

        for (const snapDoc of snapHistSnap.docs) {
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
            const existing = productCycles.get(key);
            if (existing) {
              existing.velocities.push(velocity);
              existing.lastStock = actualClosing;
            } else {
              productCycles.set(key, {
                velocities: [velocity],
                lastStock: actualClosing,
                costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
                parLevel: typeof item.parLevel === 'number' ? item.parLevel : null,
              });
            }
          }
        }
      }

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

    // FIX 7: Supplier intelligence per product
    if (productSupplierLines.length > 0) {
      lines.push("", "SUPPLIER PRICING (top products — ⭐=preferred, format: supplier(relationship,$cost/unit)):");
      productSupplierLines.forEach(l => lines.push("  " + l));
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

Your tone is direct, analytical, and honest — like a trusted CFO who respects the operator's time. No fluff. Give the number first, then the context.

If the data doesn't contain enough information to answer confidently, say so clearly: "I don't have enough data to answer that yet. Complete X more stocktakes to unlock this insight."

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
        model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
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
      });
    }
    const entries = Object.values(barStockByProduct).filter(e => e.total > 0).sort((a, b) => b.total - a.total);
    if (entries.length > 0) {
      lines.push("", `BAR STOCK TOTALS (${entries.length} products):`);
      entries.slice(0, 30).forEach(e => {
        lines.push(`  ${e.name}: ${e.total} total (${e.bars.join(", ")})`);
      });
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
        lines.push(`  ${t.productName || "?"}: ${t.quantity} from ${t.fromName || "?"} → ${t.toName || "?"}`);
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
        lines.push(`  ${r.barName || "?"}: ${r.productName || "?"} × ${r.quantity || "?"} (${r.status || "pending"})`);
      });
    }
  } catch {}

  // Wastage totals
  try {
    const wastageSnap = await db.collection(`venues/${venueId}/wastage`).limit(50).get();
    const wastageByProduct: Record<string, { name: string; total: number }> = {};
    wastageSnap.docs.forEach(d => {
      const data = d.data() as any;
      const pid = data.productId;
      if (!pid) return;
      if (!wastageByProduct[pid]) wastageByProduct[pid] = { name: data.productName || pid, total: 0 };
      wastageByProduct[pid].total += data.quantity || 0;
    });
    const wEntries = Object.values(wastageByProduct).filter(e => e.total > 0);
    if (wEntries.length > 0) {
      lines.push("", "WASTAGE TOTALS:");
      wEntries.forEach(e => lines.push(`  ${e.name}: ${e.total} units written off`));
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
      model: "claude-sonnet-4-20250514",
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
        model: "claude-sonnet-4-20250514",
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

export const api = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120, secrets: ["ANTHROPIC_API_KEY"] })
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
    trackPriceChanges({
      venueId,
      lines: lines.map((l: any) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, caseSize: l.caseSize ?? null })),
      supplierId: resolvedSupplierIdPdf,
      supplierName: supplierName || req.body?.supplierName || "",
      invoiceId: poNumber || `pdf_${storagePath}`,
    }).catch((e: any) => console.log("[api/process-invoices-pdf] price tracking error", e?.message));

  } catch (e: any) {
    console.error("[api/process-invoices-pdf] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "PDF processing failed" });
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
    const pdfData = await pdfParse(fileBuffer);
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
      `  "paymentTerms": string | null\n` +
      `}\n\nContract text:\n${text}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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

    // Update contract document (owner-only collection)
    await db.doc(`venues/${venueId}/contracts/${contractId}`).update({
      supplierName:          extracted.supplierName || null,
      contractPeriod:        extracted.contractPeriod || null,
      extractedObligations:  obligations,
      rebates,
      returnConditions:      extracted.returnConditions || null,
      paymentTerms:          extracted.paymentTerms || null,
      rawExtraction:         rawJson,
      status:                "extracted",
      updatedAt:             admin.firestore.FieldValue.serverTimestamp(),
    });

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
        model: "claude-sonnet-4-20250514",
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
