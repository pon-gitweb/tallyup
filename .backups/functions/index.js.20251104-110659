const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Safe init
try { admin.app(); } catch { admin.initializeApp(); }

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

// ---------- Existing sprint endpoints (kept) ----------
app.get("/api/entitlement", (req, res) => {
  res.setHeader("x-ai-remaining", "99");
  res.setHeader("x-ai-retry-after", "0");
  return res.json({ ok: true, entitled: true });
});

app.post("/api/entitlement/dev-grant", (req, res) => {
  res.setHeader("x-ai-remaining", "99");
  res.setHeader("x-ai-retry-after", "0");
  return res.json({ ok: true, granted: true });
});

app.post("/api/validate-promo", (req, res) => {
  res.setHeader("x-ai-remaining", "99");
  res.setHeader("x-ai-retry-after", "0");
  return res.json({ ok: true, valid: true, quota: 99 });
});

app.post("/api/suggest-orders", (req, res) => {
  try {
    const body = req.body || {};
    const { venueId, baseline } = body;
    if (!venueId || !baseline) return res.status(400).json({ error: "missing venueId/baseline" });

    const aiRemaining = Number.isFinite(Number(req.headers["x-ai-remaining"]))
      ? Number(req.headers["x-ai-remaining"])
      : 99;

    res.setHeader("x-ai-remaining", String(aiRemaining));
    res.setHeader("x-ai-retry-after", "0");
    return res.json({
      buckets: baseline.buckets || {},
      unassigned: baseline.unassigned || { lines: [] },
      meta: { rationale: "overlay_passthrough", factors: ["Server reachable","LLM not yet applied"], aiRemaining, retryAfterSeconds: 0 },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/variance-explain", (req, res) => {
  try {
    const b = req.body || {};
    const vq = Number(b.varianceQty ?? 0);
    const rv = Number(b.recentSoldQty ?? NaN);
    const rr = Number(b.recentReceivedQty ?? NaN);
    const factors = [];
    const missing = [];

    if (!b.itemName) missing.push("itemName");
    if (!("varianceQty" in b)) missing.push("varianceQty");
    if (Number.isFinite(rv) && Math.abs(rv) > 0) factors.push(`Recent sales ${rv > 0 ? "increase" : "decline"} (${rv})`);
    if (Number.isFinite(rr) && Math.abs(rr) > 0) factors.push(`Recent delivery impact (${rr})`);
    if (b.lastDeliveryAt) factors.push(`Last delivery at ${b.lastDeliveryAt}`);
    if (b.par != null) factors.push(`PAR set to ${b.par}`);

    const confidence = Math.min(0.95, Math.max(0.4,
      (Number.isFinite(rv) ? 0.15 : 0) +
      (Number.isFinite(rr) ? 0.15 : 0) +
      (b.lastDeliveryAt ? 0.1 : 0) +
      (b.par != null ? 0.1 : 0)
    ));

    const aiRemaining = 99;
    res.setHeader("x-ai-remaining", String(aiRemaining));
    res.setHeader("x-ai-retry-after", "0");
    return res.json({ summary: "Variance likely due to normal count fluctuations.", factors, missing, confidence, meta: { aiRemaining, retryAfterSeconds: 0 } });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});
// ----------------------------------------------------

// ---------- Helpers ----------
function parseCsvToRows(csvText) {
  // Very simple CSV parser: handles header + plain rows (no quoted commas).
  const lines = String(csvText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim().length);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => line.split(",").map(v => v.trim()));
  return { header, rows };
}

function normalizeInvoiceFromRows(venueId, orderId, header, rows) {
  // Expecting header like: PO,SKU,Name,Qty,UnitPrice
  const idx = {
    PO: header.findIndex(h => /^po$/i.test(h)),
    SKU: header.findIndex(h => /^sku$/i.test(h)),
    Name: header.findIndex(h => /^name$/i.test(h)),
    Qty: header.findIndex(h => /^qty$/i.test(h)),
    UnitPrice: header.findIndex(h => /^(unitprice|unit_price|price)$/i.test(h)),
  };

  const lines = rows.map(r => ({
    po: idx.PO >= 0 ? r[idx.PO] : null,
    sku: idx.SKU >= 0 ? r[idx.SKU] : null,
    name: idx.Name >= 0 ? r[idx.Name] : null,
    qty: idx.Qty >= 0 ? Number(r[idx.Qty]) : null,
    unitPrice: idx.UnitPrice >= 0 ? Number(r[idx.UnitPrice]) : null,
  }));

  const poValues = Array.from(new Set(lines.map(l => l.po).filter(Boolean)));
  const inferredPO = poValues.length ? poValues[0] : null;

  return {
    ok: true,
    venueId, orderId,
    invoiceNumber: inferredPO || null,
    source: "csv",
    confidence: 0.85, // CSV shape is strong
    lines: lines.filter(l => l.sku || l.name), // only keep populated
    missing: [],
    warnings: [],
  };
}

// ---------- New ROUTES ----------

// 1) CSV normalization — reads from GCS path you already uploaded to
app.post("/api/process-invoices-csv", async (req, res) => {
  try {
    const { venueId, orderId, storagePath } = req.body || {};
    if (!venueId || !orderId || !storagePath) {
      return res.status(400).json({ ok: false, error: "missing venueId/orderId/storagePath" });
    }

    const bucket = admin.storage().bucket(); // default bucket of this project
    const [buf] = await bucket.file(storagePath).download();
    const text = buf.toString("utf8");

    const { header, rows } = parseCsvToRows(text);
    if (!header.length) return res.status(400).json({ ok: false, error: "empty-or-invalid-csv" });

    const normalized = normalizeInvoiceFromRows(venueId, orderId, header, rows);
    return res.json(normalized);
  } catch (e) {
    console.error("[process-invoices-csv] error", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 2) PDF normalization — stub for now (lets UI proceed to manual confirm)
app.post("/api/process-invoice-pdf", async (req, res) => {
  try {
    const { venueId, orderId, storagePath } = req.body || {};
    if (!venueId || !orderId || !storagePath) {
      return res.status(400).json({ ok: false, error: "missing venueId/orderId/storagePath" });
    }
    // Future: download PDF from storagePath, run OCR (e.g., Cloud Vision), parse, then normalize.
    // For now, return an empty-but-valid structure so the UI can continue to manual review.
    return res.json({
      ok: true,
      venueId, orderId,
      invoiceNumber: null,
      source: "pdf",
      confidence: 0.2,
      lines: [],          // user will confirm/add manually
      missing: ["ocr"],
      warnings: ["PDF OCR parser not configured; manual confirmation required."],
    });
  } catch (e) {
    console.error("[process-invoice-pdf] error", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- Export single HTTPS function ----------
exports.api = functions.region("us-central1").https.onRequest(app);
