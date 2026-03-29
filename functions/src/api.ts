import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express = require("express");
import cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20mb" }));

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

    const { destPath, dataUrl, cacheControl } = req.body || {};

    if (!destPath || typeof destPath !== "string") {
      res.status(400).json({ ok: false, error: "Missing destPath" });
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
      "You are an AI assistant for Hosti-Stock, a hospitality inventory management app for NZ bars, restaurants and cafes.",
      "Explain stock variances in plain English a bar manager or chef would understand. Be concise and practical.",
      "If data is limited say so. Respond ONLY with valid JSON:",
      '{ "summary": "1-2 sentence explanation", "factors": ["factor 1"], "confidence": 0.0-1.0, "missing": ["helpful data"] }'
    ].join("\n");
    const varStr = (variance >= 0 ? "+" : "") + variance + " " + unit;
    const costStr = costPerUnit != null ? "$" + Number(costPerUnit).toFixed(2) : null;
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
app.post("/suggest-orders", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    const { venueId, baseline, context: ctx } = req.body || {};
    if (!venueId || !baseline) { res.status(400).json({ ok: false, error: "Missing venueId or baseline" }); return; }
    const buckets = baseline.buckets || {};
    const supplierSummaries = Object.entries(buckets).map(([sid, b]: any) => {
      const lines = Array.isArray(b?.lines) ? b.lines : [];
      const total = lines.reduce((a: number, l: any) => a + (Number(l.qty||0) * Number(l.unitCost||l.cost||0)), 0);
      return sid + ": " + lines.length + " lines, est $" + total.toFixed(2);
    }).join("\n");
    const systemPrompt = [
      "You are an AI ordering assistant for Hosti-Stock, a hospitality inventory app for NZ bars and restaurants.",
      "Review suggested order baselines and add intelligent insights about quantities, timing and patterns.",
      "Consider: day of week patterns, seasonal demand, upcoming weekends, typical NZ hospitality trade flows.",
      'Respond ONLY with valid JSON: { "insights": [{ "type": "warning|tip|seasonal|pattern", "message": "insight", "supplierId": "optional" }], "adjustments": [{ "productId": "id", "suggestedQty": 12, "reason": "why" }] }'
    ].join("\n");
    const today = new Date().toLocaleDateString("en-NZ", { weekday: "long", month: "long", day: "numeric" });
    const userMsg = ["Venue: " + venueId, "Today: " + today, "Order summary:", supplierSummaries || "No lines", ctx ? "Context: " + JSON.stringify(ctx) : null, "Provide insights and flag quantity adjustments."].filter(Boolean).join("\n\n");
    const raw = await callClaude(systemPrompt, userMsg);
    let parsed: any = {};
    try { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch { parsed = {}; }
    console.log("[api/suggest-orders] OK", { uid, venueId });
    res.json({ ...baseline, insights: Array.isArray(parsed.insights) ? parsed.insights : [], adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [] });
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
    const ctx = aiContext || {};
    const supplierSpend = Array.isArray(ctx.supplierSpend) ? ctx.supplierSpend : [];
    const dataQuality = ctx.dataQuality || "low";
    const stockCycles = ctx.stockCycleCount || 0;
    const orderCycles = ctx.orderCycleCount || 0;
    const frequentShortages = Array.isArray(ctx.frequentShortages) ? ctx.frequentShortages : [];
    const topRecipes = Array.isArray(ctx.topSellingRecipes) ? ctx.topSellingRecipes : [];
    const systemPrompt = [
      "You are an AI budget advisor for Hosti-Stock, a hospitality inventory app for NZ bars and restaurants.",
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
    console.log("[api/budget-suggest] OK", { uid, venueId, suggestions: suggestions.length });
    res.json({ ok: true, suggestions, overallNote: parsed.overallNote || null, dataQuality });
  } catch (e: any) {
    console.error("[api/budget-suggest] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Budget suggestion failed" });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
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

    // Download the file from Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storagePath).download();
    const csvText = fileBuffer.toString("utf-8");

    const lines = parseCsvText(csvText);
    const warnings: string[] = [];
    if (!lines.length) warnings.push("No line items could be parsed from this CSV.");

    const payload = {
      ok: true,
      invoice: { source: "csv", storagePath, poNumber: null },
      lines,
      confidence: lines.length > 0 ? 0.8 : 0.2,
      warnings,
    };

    console.log("[api/process-invoices-csv] OK", { uid, venueId, storagePath, linesCount: lines.length });
    res.json(payload);

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

    // Download the PDF from Storage
    const bucket = admin.storage().bucket();
    const [fileBuffer] = await bucket.file(storagePath).download();

    // Parse PDF text using pdf-parse
    const pdfParse = require("pdf-parse");
    const pdfData = await pdfParse(fileBuffer);
    const text = pdfData.text || "";

    const poNumber = extractPo(text);
    const invoiceNumber = extractInvoiceNumber(text);
    const deliveryDate = extractDeliveryDate(text);
    const supplierName = guessSupplierName(text);
    const lines = extractLinesFromText(text);

    const warnings: string[] = [];
    if (!lines.length) warnings.push("No line items detected — please review manually.");
    warnings.push("PDF parsed using text extraction (beta).");

    const payload = {
      ok: true,
      invoice: {
        source: "pdf",
        storagePath,
        poNumber: poNumber ?? null,
        invoiceNumber: invoiceNumber ?? null,
        deliveryDate: deliveryDate ?? null,
        supplierName: supplierName ?? null,
      },
      lines,
      confidence: lines.length > 0 ? 0.6 : 0.2,
      warnings,
    };

    console.log("[api/process-invoices-pdf] OK", { uid, venueId, storagePath, linesCount: lines.length, poNumber, supplierName });
    res.json(payload);

  } catch (e: any) {
    console.error("[api/process-invoices-pdf] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "PDF processing failed" });
  }
});
