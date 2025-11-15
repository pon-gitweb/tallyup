import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { ImageAnnotatorClient } from "@google-cloud/vision";

const vision = new ImageAnnotatorClient();

type ParsedLine = { name: string; qty: number; unitPrice?: number };

// Extract a PO / invoice-ish identifier from free text
function extractPo(text: string): string | null {
  const patterns = [
    /PO\s*#\s*([A-Z0-9\-]{3,})/i,
    /P\.?O\.?\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
    /\bPO\s*([A-Z0-9\-]{3,})\b/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }
  return null;
}

// Very simple line extraction: "NAME ... 3 12.34"
function extractLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const raw of lines) {
    const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
    const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
    const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
    const price = priceMatch ? Number(priceMatch[1]) : NaN;

    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
      const name = raw.replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "").trim();
      if (name.length >= 3) out.push({ name, qty, unitPrice: price });
    }

    if (out.length >= 80) break; // hard cap to keep payload small
  }

  // Fallback: just take first few non-empty lines as qty=1 items
  if (out.length === 0) {
    for (const raw of lines.slice(0, 20)) {
      if (raw.length >= 3) out.push({ name: raw, qty: 1 });
    }
  }

  return out;
}

// Dedicated photo-invoice OCR callable.
// Input: { venueId, imageBase64 }
// Output: { lines, supplierName?, invoiceNumber?, deliveryDate?, rawText }
export const ocrInvoicePhoto = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = String(context.auth.uid || "");
    const venueId = String(data?.venueId || "");
    const imageBase64 = String(data?.imageBase64 || "");

    if (!venueId) {
      throw new functions.https.HttpsError("invalid-argument", "venueId is required.");
    }
    if (!imageBase64) {
      throw new functions.https.HttpsError("invalid-argument", "imageBase64 is required.");
    }

    // Optional: security check – user must be a member of the venue
    const db = admin.firestore();
    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Not a member of this venue."
      );
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(imageBase64, "base64");
    } catch (e: any) {
      console.error("[ocrInvoicePhoto] invalid base64", e?.message || e);
      throw new functions.https.HttpsError("invalid-argument", "Invalid imageBase64.");
    }

    const [result] = await vision.textDetection({ image: { content: buf } });
    const text =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      "";

    if (!text.trim()) {
      console.log("[ocrInvoicePhoto] OCR returned no text");
      return {
        supplierName: null,
        invoiceNumber: null,
        deliveryDate: null,
        lines: [],
        rawText: "",
      };
    }

    const invoiceNumber = extractPo(text);
    const lines = extractLines(text);

    const payload = {
      supplierName: null as string | null,
      invoiceNumber: invoiceNumber,
      deliveryDate: null as string | null,
      lines,
      rawText: text,
    };

    console.log("[ocrInvoicePhoto] payload", {
      invoiceNumber: payload.invoiceNumber,
      linesCount: payload.lines.length,
    });

    // onCall will wrap this as { result: payload } for HTTPS; our RN client
    // supports both {result: ...} and plain object.
    return payload;
  });
