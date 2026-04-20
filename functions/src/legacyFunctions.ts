/**
 * Legacy Cloud Functions — these were deployed directly to Firebase and must
 * remain exported here so `firebase deploy --only functions` does not delete them.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const db = () => admin.firestore();

// ─── Auth helper ──────────────────────────────────────────────────────────────
async function verifyToken(req: functions.https.Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(auth.split("Bearer ")[1]);
    return decoded.uid;
  } catch {
    return null;
  }
}

// ─── CSV parser (same logic as api.ts) ───────────────────────────────────────
function parseCsvText(text: string): Array<{ name: string; qty: number; unitPrice?: number; code?: string }> {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headerRaw = lines[0].toLowerCase();
  const cols = headerRaw.split(",").map((s) => s.trim());
  const nameIdx = cols.findIndex((c) => /name|description|product|item/i.test(c));
  const qtyIdx  = cols.findIndex((c) => /qty|quantity|units|count/i.test(c));
  const priceIdx = cols.findIndex((c) => /price|cost|unit.?price|rate/i.test(c));
  const codeIdx  = cols.findIndex((c) => /code|sku|barcode/i.test(c));
  if (nameIdx >= 0 && qtyIdx >= 0) {
    const out: Array<{ name: string; qty: number; unitPrice?: number; code?: string }> = [];
    for (const raw of lines.slice(1)) {
      const parts = raw.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      const name = parts[nameIdx] || "";
      const qty  = Number(parts[qtyIdx]);
      const unitPrice = priceIdx >= 0 ? Number(parts[priceIdx]) : undefined;
      const code = codeIdx >= 0 ? parts[codeIdx] : undefined;
      if (!name || !Number.isFinite(qty) || qty <= 0) continue;
      out.push({ name, qty, unitPrice: unitPrice && Number.isFinite(unitPrice) ? unitPrice : undefined, code: code || undefined });
      if (out.length >= 200) break;
    }
    return out;
  }
  const out: Array<{ name: string; qty: number; unitPrice?: number }> = [];
  for (const raw of lines.slice(1)) {
    const parts = raw.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    const name = parts[0];
    const qty  = Number(parts[1]);
    const unitPrice = parts[2] ? Number(parts[2]) : undefined;
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, qty, unitPrice: unitPrice && Number.isFinite(unitPrice) ? unitPrice : undefined });
    if (out.length >= 200) break;
  }
  return out;
}

function extractLinesFromText(text: string): Array<{ name: string; qty: number; unitPrice?: number }> {
  const out: Array<{ name: string; qty: number; unitPrice?: number }> = [];
  const lower = text.toLowerCase();
  const start = Math.max(0, lower.indexOf("item"));
  const subtotalIdx = lower.indexOf("subtotal");
  const end = subtotalIdx > start ? subtotalIdx : Math.min(text.length, start + 2000);
  const block = text.slice(start, end);
  const rowRegex = /([A-Za-z0-9()/%., x+\-]{5,80}?)\s+(\d{1,4}(?:\.\d{1,2})?)\s+(\d{1,6}(?:\.\d{1,2})?)\s+(\d{1,8}(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(block))) {
    const name = m[1].replace(/\s{2,}/g, " ").trim();
    const qty  = Number(m[2]);
    const unitPrice = Number(m[3]);
    if (!name || name.length < 3 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    out.push({ name, qty, unitPrice });
    if (out.length >= 40) break;
  }
  return out;
}

function extractPo(text: string): string | null {
  for (const rx of [/PO\s*(?:NO\.?|NUMBER|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i, /P\.?O\.?\s*(?:NO\.?|NUMBER|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i]) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }
  return null;
}

function extractInvoiceNumber(text: string): string | null {
  for (const rx of [/Invoice\s*(?:NO\.?|Number|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i, /TAX\s+INVOICE[^\n]*?\b([A-Z]{2,}-\d{3,})\b/i]) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }
  const fb = text.match(/\bINV[-\s]?\d{3,}\b/i);
  return fb?.[0]?.toUpperCase().slice(0, 64) ?? null;
}

function extractDeliveryDate(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const dateRx = [/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/, /\b(\d{4}-\d{2}-\d{2})\b/];
  for (const raw of lines) {
    if (!/(delivery|date|invoice)/i.test(raw)) continue;
    for (const rx of dateRx) { const m = raw.match(rx); if (m?.[1]) return m[1].slice(0, 32); }
  }
  for (const raw of lines) {
    for (const rx of dateRx) { const m = raw.match(rx); if (m?.[1]) return m[1].slice(0, 32); }
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
    if (/(invoice|statement|po #|item qty|subtotal|gst|total)/i.test(lower)) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (line.length >= 3 && line.length <= 64) candidates.push(line);
  }
  return candidates.find((c) => /(foods|foodservice|distributors|limited|ltd|wholesale|suppl|nz)\b/i.test(c)) ?? candidates[0] ?? null;
}

async function extractLinesWithClaude(rawText: string): Promise<Array<{ name: string; qty: number; unitPrice?: number }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: [
        "You are an expert at reading NZ hospitality supplier invoices (Bidfood, Gilmours, Hancocks, etc).",
        "Extract ALL line items from the invoice text.",
        "Return ONLY valid JSON array, no markdown, no explanation:",
        '[{ "name": "product name", "qty": 3, "unitPrice": 12.50 }]',
        "Rules: name is clean product name, qty is numeric quantity, unitPrice is NZD per unit or null, skip headers/totals/GST.",
      ].join("\n"),
      messages: [{ role: "user", content: "Extract line items from this invoice:\n\n" + rawText.slice(0, 8000) }],
    }),
  });
  if (!resp.ok) throw new Error("Claude OCR error: " + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || "[]";
  const match = text.match(/\[[\s\S]*\]/);
  const lines = match ? JSON.parse(match[0]) : [];
  return lines.filter((l: any) => l && l.name && l.qty > 0).map((l: any) => ({
    name: String(l.name).trim(),
    qty: Number(l.qty),
    unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 1. processInvoicesCsv  — standalone HTTP wrapper around CSV invoice parsing
// ════════════════════════════════════════════════════════════════════════════
export const processInvoicesCsv = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, storagePath } = req.body || {};
      if (!venueId || !storagePath) { res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return; }
      const [buf] = await admin.storage().bucket().file(storagePath).download();
      const lines = parseCsvText(buf.toString("utf-8"));
      const warnings: string[] = lines.length === 0 ? ["No line items could be parsed from this CSV."] : [];
      res.json({ ok: true, invoice: { source: "csv", storagePath, poNumber: null }, lines, confidence: lines.length > 0 ? 0.8 : 0.2, warnings });
    } catch (e: any) {
      console.error("[processInvoicesCsv]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "CSV processing failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 2. processInvoicesPdf  — standalone HTTP wrapper around PDF invoice parsing
// ════════════════════════════════════════════════════════════════════════════
export const processInvoicesPdf = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120, secrets: ["ANTHROPIC_API_KEY"] })
  .https.onRequest(async (req, res) => {
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, storagePath } = req.body || {};
      if (!venueId || !storagePath) { res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return; }
      const [buf] = await admin.storage().bucket().file(storagePath).download();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require("pdf-parse");
      const pdfData = await pdfParse(buf);
      const text = pdfData.text || "";
      let lines: any[] = [];
      try {
        lines = await extractLinesWithClaude(text);
        if (!lines.length) throw new Error("no lines");
      } catch {
        lines = extractLinesFromText(text);
      }
      const warnings: string[] = [];
      if (!lines.length) warnings.push("No line items detected — please review manually.");
      warnings.push("PDF parsed using text extraction (beta).");
      res.json({
        ok: true,
        invoice: {
          source: "pdf", storagePath,
          poNumber: extractPo(text) ?? null,
          invoiceNumber: extractInvoiceNumber(text) ?? null,
          deliveryDate: extractDeliveryDate(text) ?? null,
          supplierName: guessSupplierName(text) ?? null,
        },
        lines,
        confidence: lines.length > 0 ? 0.6 : 0.2,
        warnings,
      });
    } catch (e: any) {
      console.error("[processInvoicesPdf]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "PDF processing failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 3. processSalesCsv  — parse a sales CSV from Storage
// ════════════════════════════════════════════════════════════════════════════
export const processSalesCsv = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, storagePath, filename } = req.body || {};
      if (!venueId || !storagePath) { res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return; }
      const [buf] = await admin.storage().bucket().file(storagePath).download();
      const text = buf.toString("utf-8");
      const rawLines = text.split(/\r?\n/).filter(Boolean);
      const warnings: string[] = rawLines.length <= 1 ? ["CSV appears empty or header-only"] : [];
      res.json({ ok: true, source: "csv", storagePath, filename: filename || null, rawLineCount: rawLines.length, text: text.slice(0, 50000), warnings });
    } catch (e: any) {
      console.error("[processSalesCsv]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "Sales CSV processing failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 4. processProductsCsv  — parse a products CSV from Storage into product rows
// ════════════════════════════════════════════════════════════════════════════
export const processProductsCsv = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, storagePath } = req.body || {};
      if (!venueId || !storagePath) { res.status(400).json({ ok: false, error: "Missing venueId or storagePath" }); return; }
      const [buf] = await admin.storage().bucket().file(storagePath).download();
      const text = buf.toString("utf-8");
      const rows = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!rows.length) { res.json({ ok: true, products: [], warnings: ["CSV is empty"] }); return; }
      const header = rows[0].toLowerCase().split(",").map((s) => s.trim());
      const nameIdx = header.findIndex((c) => /name|product|description/i.test(c));
      const unitIdx = header.findIndex((c) => /unit/i.test(c));
      const costIdx = header.findIndex((c) => /cost|price/i.test(c));
      const skuIdx  = header.findIndex((c) => /sku|code|barcode/i.test(c));
      const products: any[] = [];
      for (const raw of rows.slice(1)) {
        const parts = raw.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        const name = nameIdx >= 0 ? parts[nameIdx] || "" : parts[0] || "";
        if (!name) continue;
        products.push({
          name,
          unit: unitIdx >= 0 ? parts[unitIdx] || null : null,
          costPrice: costIdx >= 0 ? Number(parts[costIdx]) || null : null,
          sku: skuIdx >= 0 ? parts[skuIdx] || null : null,
        });
        if (products.length >= 500) break;
      }
      res.json({ ok: true, products, count: products.length, warnings: [] });
    } catch (e: any) {
      console.error("[processProductsCsv]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "Products CSV processing failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 5. uploadCsv  — accept base64/text CSV body and write to Storage
// ════════════════════════════════════════════════════════════════════════════
export const uploadCsv = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, destPath, text, base64 } = req.body || {};
      if (!venueId || !destPath) { res.status(400).json({ ok: false, error: "Missing venueId or destPath" }); return; }
      if (!text && !base64) { res.status(400).json({ ok: false, error: "Missing text or base64" }); return; }
      const buf = base64 ? Buffer.from(base64, "base64") : Buffer.from(text, "utf-8");
      const file = admin.storage().bucket().file(destPath);
      await file.save(buf, { metadata: { contentType: "text/csv" } });
      const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      res.json({ ok: true, fullPath: destPath, downloadURL: url });
    } catch (e: any) {
      console.error("[uploadCsv]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 6. uploadShelfScanPhotoCallable  — callable: upload a shelf scan photo
// ════════════════════════════════════════════════════════════════════════════
export const uploadShelfScanPhotoCallable = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required");
    const { venueId, scanId, base64, contentType } = data || {};
    if (!venueId || !scanId || !base64) throw new functions.https.HttpsError("invalid-argument", "Missing venueId, scanId, or base64");
    const ext = (contentType || "image/jpeg").includes("png") ? ".png" : ".jpg";
    const destPath = `venues/${venueId}/shelfScans/${scanId}/photo${ext}`;
    const buf = Buffer.from(base64, "base64");
    const file = admin.storage().bucket().file(destPath);
    await file.save(buf, { metadata: { contentType: contentType || "image/jpeg" } });
    const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    return { ok: true, fullPath: destPath, url };
  });

// ════════════════════════════════════════════════════════════════════════════
// 7. onShelfScanJobCreate  — Firestore trigger: process new shelf scan job
// ════════════════════════════════════════════════════════════════════════════
export const onShelfScanJobCreate = functions
  .region("us-central1")
  .firestore.document("venues/{venueId}/shelfScanJobs/{jobId}")
  .onCreate(async (snap, context) => {
    const { venueId, jobId } = context.params;
    const data = snap.data() as any;
    try {
      await snap.ref.update({
        status: "queued",
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[onShelfScanJobCreate] queued", { venueId, jobId, photoUrl: data?.photoUrl });
    } catch (e: any) {
      console.error("[onShelfScanJobCreate] error", e?.message || e);
      await snap.ref.update({ status: "error", errorMessage: e?.message || String(e) }).catch(() => {});
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 8. varianceDepartmentReport  — HTTP: compute department-level variance
//    Deployed in australia-southeast1 (referenced from client varianceRemote.ts)
// ════════════════════════════════════════════════════════════════════════════
export const varianceDepartmentReport = functions
  .region("australia-southeast1")
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
  .https.onRequest(async (req, res) => {
    // Allow CORS for direct browser/RN fetches
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const { venueId, departmentId } = req.body || {};
      if (!venueId) { res.status(400).json({ ok: false, error: "Missing venueId" }); return; }
      const firestore = db();
      // Fetch all items, optionally scoped to department
      let itemsQ: admin.firestore.Query = firestore.collection(`venues/${venueId}/items`);
      if (departmentId) itemsQ = itemsQ.where("departmentId", "==", departmentId);
      const itemsSnap = await itemsQ.get();
      const shortages: any[] = [];
      const excesses: any[] = [];
      let totalShortageValue = 0;
      let totalExcessValue = 0;
      itemsSnap.forEach((d) => {
        const item = d.data() as any;
        const par = Number(item.parLevel ?? item.par ?? item.expectedQty ?? 0);
        const onHand = Number(item.lastCount ?? 0);
        const variance = onHand - par;
        const unitCost = Number(item.costPrice ?? item.unitCost ?? 0);
        const value = Math.abs(variance) * unitCost;
        if (variance < 0) {
          shortages.push({ id: d.id, name: item.name || "", par, onHand, variance, value, unit: item.unit || null });
          totalShortageValue += value;
        } else if (variance > 0) {
          excesses.push({ id: d.id, name: item.name || "", par, onHand, variance, value, unit: item.unit || null });
          totalExcessValue += value;
        }
      });
      shortages.sort((a, b) => b.value - a.value);
      excesses.sort((a, b) => b.value - a.value);
      res.json({ ok: true, venueId, departmentId: departmentId ?? null, shortages, excesses, totalShortageValue, totalExcessValue });
    } catch (e: any) {
      console.error("[varianceDepartmentReport]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "Variance report failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 9. aiVarianceExplain  — HTTP: Claude-powered variance explanation
// ════════════════════════════════════════════════════════════════════════════
export const aiVarianceExplain = functions
  .region("us-central1")
  .runWith({ memory: "256MB", timeoutSeconds: 60, secrets: ["ANTHROPIC_API_KEY"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const uid = await verifyToken(req);
      if (!uid) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
      const ctx = req.body || {};
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
      const productName = ctx.itemName || ctx.name || ctx.productId || "Product";
      const onHand = Number(ctx.counted ?? ctx.onHand ?? 0);
      const expected = Number(ctx.expected ?? ctx.par ?? 0);
      const variance = onHand - expected;
      const unit = ctx.unit || "units";
      const varStr = (variance >= 0 ? "+" : "") + variance + " " + unit;
      const lines = [
        "Product: " + productName,
        "On hand: " + onHand + " " + unit,
        "Expected: " + expected + " " + unit,
        "Variance: " + varStr,
        ctx.salesQty != null ? "Recent sales: " + ctx.salesQty + " " + unit : null,
        ctx.invoiceQty != null ? "Recently received: " + ctx.invoiceQty + " " + unit : null,
        ctx.costPerUnit != null ? "Cost per unit: $" + Number(ctx.costPerUnit).toFixed(2) : null,
      ].filter(Boolean).join("\n");
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          system: "You are an AI assistant for a hospitality inventory app. Explain stock variances in plain English. Respond ONLY with valid JSON: { \"summary\": \"1-2 sentence explanation\", \"factors\": [\"factor\"], \"confidence\": 0.0-1.0 }",
          messages: [{ role: "user", content: "Explain this variance:\n\n" + lines }],
        }),
      });
      if (!resp.ok) throw new Error("Claude error: " + resp.status);
      const data = await resp.json() as any;
      const raw = data?.content?.[0]?.text || "{}";
      let parsed: any = {};
      try { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; } catch { parsed = { summary: raw.slice(0, 300) }; }
      res.json({ summary: parsed.summary || "No explanation available.", factors: Array.isArray(parsed.factors) ? parsed.factors : [], confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5 });
    } catch (e: any) {
      console.error("[aiVarianceExplain]", e?.message || e);
      res.status(500).json({ ok: false, error: e?.message || "Explanation failed" });
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 10. allocatePo  — callable: reserve and return the next PO number for venue
// ════════════════════════════════════════════════════════════════════════════
export const allocatePo = functions
  .region("us-central1")
  .runWith({ memory: "128MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required");
    const venueId = data?.venueId;
    if (!venueId) throw new functions.https.HttpsError("invalid-argument", "Missing venueId");
    const firestore = db();
    const counterRef = firestore.doc(`venues/${venueId}/meta/poCounter`);
    const poNumber = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = (snap.data()?.lastPo as number) || 1000;
      const next = current + 1;
      tx.set(counterRef, { lastPo: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return next;
    });
    const poString = "PO-" + String(poNumber).padStart(4, "0");
    return { ok: true, poNumber: poString, sequence: poNumber };
  });

// ════════════════════════════════════════════════════════════════════════════
// 11. ensureVenueDefaultsCallable  — callable: write missing venue defaults
// ════════════════════════════════════════════════════════════════════════════
export const ensureVenueDefaultsCallable = functions
  .region("us-central1")
  .runWith({ memory: "128MB", timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Auth required");
    const venueId = data?.venueId;
    if (!venueId) throw new functions.https.HttpsError("invalid-argument", "Missing venueId");
    const firestore = db();
    const venueRef = firestore.doc(`venues/${venueId}`);
    const snap = await venueRef.get();
    if (!snap.exists) throw new functions.https.HttpsError("not-found", `Venue ${venueId} not found`);
    const existing = snap.data() || {};
    const defaults: Record<string, any> = {};
    if (!existing.settings) defaults.settings = {};
    if (!existing.billingPlan) defaults.billingPlan = "beta";
    if (!existing.onboardingStep) defaults.onboardingStep = "ready";
    if (!existing.createdAt) defaults.createdAt = admin.firestore.FieldValue.serverTimestamp();
    if (Object.keys(defaults).length > 0) {
      await venueRef.set({ ...defaults, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    return { ok: true, venueId, applied: Object.keys(defaults) };
  });
