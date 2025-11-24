import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { ImageAnnotatorClient } from "@google-cloud/vision";

const vision = new ImageAnnotatorClient();

type ParsedLine = { name: string; qty: number; unitPrice?: number };

type FastReceiveData = {
  venueId?: string;
  fastId?: string;
  storagePath?: string;
};

// --- Helpers ----------------------------------------------------

// Extract a PO / order-like identifier, but ONLY from real "PO #" style tokens
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

// Extract an invoice number (can be same as PO, but often different label)
function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /Invoice\s*(?:NO\.?|Number|#)\s*[:#]?\s*([A-Z0-9\-]{3,})/i, // "Invoice #: INV-12032"
    /TAX\s+INVOICE[^\n]*?\b([A-Z]{2,}-\d{3,})\b/i,              // "... TAX INVOICE ... INV-12032"
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m?.[1]) return m[1].toUpperCase().slice(0, 64);
  }

  // Fallback: typical INV- style token anywhere
  const fallback = text.match(/\bINV[-\s]?\d{3,}\b/i);
  if (fallback?.[0]) return fallback[0].toUpperCase().slice(0, 64);

  return null;
}

// Extract a delivery or invoice date (very simple heuristic)
function extractDeliveryDate(text: string): string | null {
  const lines = text.split(/\r?\n/);

  const datePatterns: RegExp[] = [
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ];

  for (const raw of lines) {
    const lower = raw.toLowerCase();
    const isInteresting =
      lower.includes("delivery") ||
      lower.includes("date") ||
      lower.includes("tax invoice") ||
      lower.includes("invoice");

    if (!isInteresting) continue;

    for (const rx of datePatterns) {
      const m = raw.match(rx);
      if (m?.[1]) return m[1].slice(0, 32);
    }
  }

  // Fallback: first date-like thing anywhere
  for (const raw of lines) {
    for (const rx of datePatterns) {
      const m = raw.match(rx);
      if (m?.[1]) return m[1].slice(0, 32);
    }
  }

  return null;
}

// Best-effort guess of supplier name from header lines
function guessSupplierName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates: string[] = [];

  for (const raw of lines.slice(0, 12)) {
    let line = raw;

    // If line contains "Tax Invoice", keep just the part before that
    const idx = line.toLowerCase().indexOf("tax invoice");
    if (idx > 0) {
      line = line.slice(0, idx).trim();
    }

    const lower = line.toLowerCase();

    if (!line) continue;
    if (lower.includes("invoice")) continue;
    if (lower.includes("statement")) continue;
    if (lower.includes("po #") || lower.includes("po #:")) continue;
    if (lower.includes("item qty") || lower.includes("qty unit")) continue;
    if (lower.includes("subtotal") || lower.includes("gst")) continue;
    if (lower.includes("total (incl")) continue;
    if (lower.includes("page")) continue; // avoid "1 page"

    // Must contain letters, not just numbers
    if (!/[A-Za-z]/.test(line)) continue;

    // Avoid lines that are probably addresses/phones only
    if (/\b\d{3,}\b/.test(line) && !/[A-Za-z]{3,}/.test(line)) continue;

    if (line.length >= 3 && line.length <= 64) {
      candidates.push(line);
    }
  }

  // Prefer something with typical supplier-ish hints
  const preferred = candidates.find((c) =>
    /(foods|foodservice|distributors|limited|ltd|wholesale|suppl|nz)\b/i.test(c)
  );
  if (preferred) return preferred;

  return candidates[0] ?? null;
}

// Extract invoice line items from the table region
function extractLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];

  const lower = text.toLowerCase();
  const tableStart = lower.indexOf("item");
  const qtyHeaderIndex = lower.indexOf("qty", tableStart >= 0 ? tableStart : 0);
  const subtotalIndex = lower.indexOf("subtotal");

  const start =
    tableStart >= 0 ? tableStart : qtyHeaderIndex >= 0 ? qtyHeaderIndex : 0;
  const end =
    subtotalIndex > start ? subtotalIndex : Math.min(text.length, start + 2000);

  const block = text.slice(start, end);

  // Pattern: [Name ...]  [Qty]  [UnitPrice]  [LineTotal]
  const rowRegex =
    /([A-Za-z0-9()/%., x+\-]{5,80}?)\s+(\d{1,4}(?:\.\d{1,2})?)\s+(\d{1,6}(?:\.\d{1,2})?)\s+(\d{1,8}(?:\.\d{1,2})?)/g;

  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(block))) {
    const name = m[1].replace(/\s{2,}/g, " ").trim();
    const qty = Number(m[2]);
    const unitPrice = Number(m[3]);
    // const lineTotal = Number(m[4]); // not used yet

    if (!name || name.length < 3) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    out.push({ name, qty, unitPrice });

    if (out.length >= 40) break;
  }

  // If we still got nothing, fall back to a simpler per-line heuristic
  if (!out.length) {
    const lines = block
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const raw of lines) {
      const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
      const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
      const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
      const price = priceMatch ? Number(priceMatch[1]) : NaN;

      if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
        const name = raw
          .replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "")
          .trim();
        if (name.length >= 3) out.push({ name, qty, unitPrice: price });
      }

      if (out.length >= 40) break;
    }
  }

  return out;
}

// Clean lines so Firestore never sees `undefined`
function makeLinesFirestoreSafe(lines: ParsedLine[]): ParsedLine[] {
  return (lines || []).map((l) => {
    const safe: ParsedLine = {
      name: String(l.name || "").slice(0, 200),
      qty:
        Number.isFinite(Number(l.qty)) && Number(l.qty) > 0
          ? Number(l.qty)
          : 1,
    };

    if (typeof l.unitPrice === "number" && !Number.isNaN(l.unitPrice)) {
      safe.unitPrice = l.unitPrice;
    }

    return safe;
  });
}

// --- Callable function ------------------------------------------

export const ocrFastReceivePhoto = functions
  .region("us-central1")
  .https.onCall(async (data: FastReceiveData, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const uid = String(context.auth.uid || "");
    const venueId = String(data?.venueId || "");
    const fastId = data?.fastId ? String(data.fastId) : "";
    const storagePathArg = data?.storagePath ? String(data.storagePath) : "";

    if (!venueId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "venueId is required."
      );
    }

    const db = admin.firestore();
    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Not a member of this venue."
      );
    }

    // Load snapshot by ID, else fallback to storagePath
    let fastRef = fastId
      ? db.doc(`venues/${venueId}/fastReceives/${fastId}`)
      : null;
    let fastSnap = fastRef ? await fastRef.get() : null;

    if (!fastSnap?.exists) {
      if (!storagePathArg) {
        throw new functions.https.HttpsError(
          "not-found",
          "Snapshot not found and no storagePath provided."
        );
      }
      const q = await db
        .collection(`venues/${venueId}/fastReceives`)
        .where("storagePath", "==", storagePathArg)
        .limit(1)
        .get();
      if (q.empty) {
        throw new functions.https.HttpsError(
          "not-found",
          "Snapshot not found by storagePath."
        );
      }
      fastSnap = q.docs[0];
      fastRef = fastSnap.ref;
    }

    const fast = fastSnap!.data() || {};
    const storagePath = String(
      fast.storagePath ||
        fast?.payload?.invoice?.storagePath ||
        storagePathArg ||
        ""
    );

    if (!storagePath) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No storagePath on snapshot."
      );
    }

    const bucket = admin.storage().bucket();
    console.log(
      "[ocrFastReceivePhoto] bucket=",
      bucket.name,
      "storagePath=",
      storagePath
    );

    let buf: Buffer;
    try {
      [buf] = await bucket.file(storagePath).download();
    } catch (e) {
      const err = e as any;
      const msg = err?.message || String(err);
      console.error("[ocrFastReceivePhoto] download failed", { storagePath }, msg);
      throw new functions.https.HttpsError(
        "internal",
        "download failed: " + msg
      );
    }

    const [result] = await vision.textDetection({ image: { content: buf } });
    const text =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      "";

    if (!text.trim()) {
      await fastRef!.set(
        {
          payload: {
            ...(fast.payload || {}),
            warnings: ["OCR returned no text."],
          },
        },
        { merge: true }
      );
      return {
        ok: true,
        parsedPo: null,
        linesCount: 0,
        info: "no-text" as const,
      };
    }

    const parsedPo = extractPo(text);
    const invoiceNumber = extractInvoiceNumber(text);
    const deliveryDate = extractDeliveryDate(text);
    const supplierName = guessSupplierName(text);

    const rawLines = extractLines(text);
    const safeLines = makeLinesFirestoreSafe(rawLines);
    const confidence = 0.5;

    const warnings: string[] = [];
    if (!safeLines.length) {
      warnings.push("No obvious line items detected; please check carefully.");
    }
    warnings.push("OCR processed (beta heuristics).");

    await fastRef!.set(
      {
        parsedPo: parsedPo ?? null,
        payload: {
          ...(fast.payload || {}),
          invoice: {
            ...(fast.payload?.invoice || {}),
            source: "photo",
            storagePath,
            supplierName: supplierName ?? null,
            invoiceNumber: invoiceNumber ?? null,
            deliveryDate: deliveryDate ?? null,
            poNumber: parsedPo ?? null,
          },
          lines: safeLines,
          confidence,
          warnings,
          rawText: text,
        },
      },
      { merge: true }
    );

    return {
      ok: true,
      parsedPo,
      linesCount: safeLines.length,
      supplierName,
      invoiceNumber,
      deliveryDate,
    };
  });
