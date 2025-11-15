"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const visionLib = require("@google-cloud/vision");

// Single Vision client (reused across invocations)
const vision = new visionLib.ImageAnnotatorClient();

/**
 * Try to extract a PO / invoice number from free text.
 */
function extractPo(text) {
  const patterns = [
    /PO\s*#\s*([A-Z0-9\-]{3,})/i,
    /P\.?O\.?\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
    /\bPO\s*([A-Z0-9\-]{3,})\b/i,
    // Require INV + whitespace so we don't match inside "INVOICE"
    /\bINV\s+[:#]?\s*([A-Z0-9\-]{3,})\b/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m[1]) return m[1].toUpperCase().slice(0, 64);
  }
  return null;
}

/**
 * Very simple heuristic line parser:
 *  - look for "<name> ... <qty> ... <price>"
 *  - fall back to first N lines with qty=1 if nothing structured found
 */
function extractLines(text) {
  const out = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const raw of lines) {
    // e.g. "Heineken 24x330ml 2 @ 34.50"
    const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
    const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
    const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
    const price = priceMatch ? Number(priceMatch[1]) : NaN;

    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
      const name = raw
        .replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "")
        .trim();
      if (name.length >= 3) {
        out.push({ name, qty, unitPrice: price });
      }
    }
    if (out.length >= 40) break;
  }

  // Fallback: no structured lines – just treat first few as qty=1
  if (out.length === 0) {
    for (const raw of lines.slice(0, 15)) {
      if (raw.length >= 3) {
        out.push({ name: raw, qty: 1 });
      }
    }
  }

  return out;
}

/**
 * Callable function:
 *   data: { venueId: string, imageBase64: string }
 * Returns:
 *   { supplierName?, invoiceNumber?, deliveryDate?, lines: [{ name, qty, unitPrice? }] }
 * in the exact shape expected by src/services/ocr/photoOcr.ts
 */
exports.ocrInvoicePhoto = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = String(context.auth.uid || "");
    const venueId = data && data.venueId ? String(data.venueId) : "";
    const imageBase64 = data && data.imageBase64 ? String(data.imageBase64) : "";

    if (!venueId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "venueId is required."
      );
    }
    if (!imageBase64) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "imageBase64 is required."
      );
    }

    // Membership check (same pattern as other venue functions)
    const db = admin.firestore();
    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Not a member of this venue."
      );
    }

    let buf;
    try {
      buf = Buffer.from(imageBase64, "base64");
    } catch (e) {
      console.error("[ocrInvoicePhoto] base64 decode failed", e);
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Could not decode imageBase64."
      );
    }

    const [result] = await vision.textDetection({ image: { content: buf } });

    const fullText =
      (result &&
        result.fullTextAnnotation &&
        result.fullTextAnnotation.text) ||
      (result &&
        Array.isArray(result.textAnnotations) &&
        result.textAnnotations[0] &&
        result.textAnnotations[0].description) ||
      "";

    if (!fullText || !fullText.trim()) {
      console.warn("[ocrInvoicePhoto] OCR returned no text.");
      return {
        supplierName: null,
        invoiceNumber: null,
        deliveryDate: null,
        lines: [],
      };
    }

    const invoiceNumber = extractPo(fullText);
    const parsedLines = extractLines(fullText);

    console.log("[ocrInvoicePhoto] parsed summary", {
      invoiceNumber,
      linesCount: parsedLines.length,
    });

    return {
      supplierName: null, // can be enhanced later
      invoiceNumber: invoiceNumber || null,
      deliveryDate: null,
      lines: parsedLines,
    };
  });
