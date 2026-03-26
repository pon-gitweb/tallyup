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

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

export const api = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
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
