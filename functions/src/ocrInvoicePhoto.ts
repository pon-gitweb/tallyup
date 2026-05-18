import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { trackPriceChanges } from "./priceTracking";
import { contributeToGlobalDirectory } from "./globalSuppliers";
import { filterInvoiceLines } from "./invoiceFilter";

const vision = new ImageAnnotatorClient();

type ParsedLine = {
  name: string;
  qty: number;
  unitPrice?: number;
  code?: string;
  total?: number;
  unit?: string;
};

// Regex fallback for line items when Claude fails
function extractLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const raw of lines) {
    const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
    const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
    const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
    const price = priceMatch ? Number(priceMatch[1]) : NaN;
    if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
      const name = raw.replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "").trim();
      if (name.length >= 3) out.push({ name, qty, unitPrice: price });
    }
    if (out.length >= 80) break;
  }
  if (out.length === 0) {
    for (const raw of lines.slice(0, 20)) {
      if (raw.length >= 3) out.push({ name: raw, qty: 1 });
    }
  }
  return out;
}

// ── Invoice age helpers ────────────────────────────────────────────────────

function invoiceAgeDays(dateStr: string | null): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch {
    return null;
  }
}

type AgeCategory = "current" | "late" | "historical" | "old" | "very_old" | "unknown";

function categorizeAge(days: number | null): AgeCategory {
  if (days === null) return "unknown";
  if (days < 30)   return "current";
  if (days < 90)   return "late";
  if (days < 365)  return "historical";
  if (days < 1095) return "old";
  return "very_old";
}

function buildHistoricalExplanation(
  category: AgeCategory,
  supplierName: string | null,
  invoiceDateStr: string | null,
  lineCount: number,
  ageDays: number | null,
): string | null {
  if (category === "current" || category === "late" || category === "unknown") return null;

  const supplier = supplierName || "Supplier";
  const dateLabel = invoiceDateStr || "an earlier date";
  const monthsAgo = ageDays ? Math.round(ageDays / 30) : null;
  const ageDesc = monthsAgo
    ? monthsAgo >= 12
      ? `${Math.round(monthsAgo / 12)} year${Math.round(monthsAgo / 12) !== 1 ? "s" : ""} old`
      : `${monthsAgo} month${monthsAgo !== 1 ? "s" : ""} old`
    : "older than 3 months";

  let explanation = `📄 ${supplier} — ${dateLabel}\n\nThis invoice is ${ageDesc} so we won't add it as received stock.\n\nBut we've captured some useful things:\n`;

  explanation += `✓ Supplier set up: ${supplier} with contact details\n`;
  if (lineCount > 0) explanation += `✓ ${lineCount} products added to your catalogue\n`;
  explanation += `✓ Historical pricing recorded\n`;
  explanation += `✓ Invoice number saved for your records\n\n`;

  explanation += `Your current stock won't be affected — but your supplier and product records are ready to go.\n\n`;
  explanation += `Next time a ${supplier} invoice arrives we'll recognise it instantly. 🤝`;

  if (category === "old") {
    explanation += `\n\nPrices may have changed since this invoice. We've noted the historical prices for reference.`;
  }

  return explanation;
}

// ── Claude-powered full invoice extraction ────────────────────────────────

type InvoiceExtraction = {
  supplierName: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  supplierAddress: string | null;
  purchaseOrderNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  deliveryDate: string | null;
  totalAmount: number | null;
  gstAmount: number | null;
  lines: ParsedLine[];
};

async function extractInvoiceWithClaude(rawText: string): Promise<InvoiceExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = [
    "You are an expert at reading NZ hospitality supplier invoices (Bidfood, Gilmours, Hancocks, Bidfresh, Lion, DB, Frucor, etc).",
    "Extract the following from this invoice text and return ONLY valid JSON, no markdown:",
    JSON.stringify({
      supplierName: "string — the VENDOR who issued this invoice (large company name/logo at top)",
      supplierPhone: "string or null",
      supplierEmail: "string or null",
      supplierAddress: "string or null — supplier address, NOT delivery address",
      purchaseOrderNumber: "string or null — may be labelled PO#, PO Number, Order No, Our Order, Reference, Ref, Your Order. This is the BUYER's order number.",
      invoiceNumber: "string or null — the supplier's invoice number",
      invoiceDate: "string or null — YYYY-MM-DD format preferred",
      deliveryDate: "string or null — delivery date if different from invoice date",
      totalAmount: "number or null — total inc GST",
      gstAmount: "number or null",
      lines: [{ name: "product name", code: "item code", qty: 1, unitPrice: 0, total: 0, unit: "ea" }],
    }),
    "",
    "CRITICAL — supplierName rules:",
    "- supplierName is the VENDOR who ISSUED this invoice (the seller/supplier company).",
    "- It is the large company name or logo at the TOP of the invoice.",
    "- Examples: Gilmours, Bidfresh, Hancocks, Lion, DB Breweries, Bidfood, Frucor.",
    "- NOT the delivery address, NOT the customer name, NOT the venue or restaurant.",
    "- On a Gilmours invoice: supplierName = 'Gilmours'. On a Bidfresh invoice: supplierName = 'Bidfresh'.",
    "- The bar, restaurant, or hotel receiving the delivery is the CUSTOMER, not the supplier.",
    "",
    "Line item rules:",
    "- name: clean product name without extra whitespace",
    "- code: supplier item code/SKU if visible, null otherwise",
    "- qty: numeric quantity ordered — a plain integer or decimal, NEVER a dollar amount",
    "- unitPrice: price per unit in NZD, null if not found",
    "- total: line total in NZD, null if not found",
    "- unit: unit of measure (ea, kg, L, case) if shown",
    "",
    "NEVER include as a product line:",
    "- Any line where the description is a number only (with or without $ symbol)",
    "- Any line that is a price, total, subtotal, GST amount, or financial summary",
    "- Any line where the description is a unit of measure only (EA, PKT, BOT, CTN, KG, L, kg)",
    "- Any line with only a code or reference number but no meaningful product description",
    "- Delivery charges, freight, handling fees, surcharges, account fees",
    "- Page numbers, invoice numbers, dates, terms of payment",
    "- Header rows or column labels",
    "",
    "A valid product line MUST have:",
    "- A recognisable product name (a brand name, or a description of at least 2–3 words)",
    "- A positive quantity that is a plain number with no $ symbol",
    "- A unit price that is plausible for that type of product",
    "",
    "- SKIP: header rows, totals, GST lines, freight, delivery charges, surcharges, account fees",
    "- SKIP: lines where name is a date, a bare number, or a dollar amount",
    "- SKIP: lines with qty <= 0 or qty > 10000",
    "- Only include actual purchasable products with a name and qty",
    "- Expand abbreviations (e.g. Sav Blanc = Sauvignon Blanc)",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: "Extract invoice data from this text:\n\n" + rawText.slice(0, 8000) }],
    }),
  });

  if (!resp.ok) throw new Error("Claude invoice error: " + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  const lines: ParsedLine[] = Array.isArray(parsed.lines)
    ? parsed.lines.filter((l: any) => l && l.name && Number(l.qty) > 0).map((l: any) => ({
        name: String(l.name).trim(),
        qty: Number(l.qty),
        unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
        code: l.code ? String(l.code).trim() : undefined,
        total: l.total != null ? Number(l.total) : undefined,
        unit: l.unit ? String(l.unit).trim() : undefined,
      }))
    : [];

  return {
    supplierName: parsed.supplierName ? String(parsed.supplierName).trim() : null,
    supplierPhone: parsed.supplierPhone ? String(parsed.supplierPhone).trim() : null,
    supplierEmail: parsed.supplierEmail ? String(parsed.supplierEmail).trim() : null,
    supplierAddress: parsed.supplierAddress ? String(parsed.supplierAddress).trim() : null,
    purchaseOrderNumber: parsed.purchaseOrderNumber ? String(parsed.purchaseOrderNumber).trim() : null,
    invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
    invoiceDate: parsed.invoiceDate ? String(parsed.invoiceDate).trim() : null,
    deliveryDate: parsed.deliveryDate ? String(parsed.deliveryDate).trim() : null,
    totalAmount: Number.isFinite(Number(parsed.totalAmount)) ? Number(parsed.totalAmount) : null,
    gstAmount: Number.isFinite(Number(parsed.gstAmount)) ? Number(parsed.gstAmount) : null,
    lines,
  };
}

// ── PO → Order matching ────────────────────────────────────────────────────

async function findAndLinkOrder(
  db: admin.firestore.Firestore,
  venueId: string,
  poNumber: string,
): Promise<{ orderId: string; orderNumber: string } | null> {
  if (!poNumber.trim()) return null;

  const ordersCol = db.collection(`venues/${venueId}/orders`);

  // Try exact match on poNumber field first
  for (const field of ["poNumber", "supplierReference", "orderNumber"]) {
    try {
      const snap = await ordersCol.where(field, "==", poNumber.trim()).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data() as any;
        await d.ref.update({
          status: "invoiced",
          invoicedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("[ocrInvoicePhoto] matched order", { orderId: d.id, field, poNumber });
        return { orderId: d.id, orderNumber: data.poNumber || data.orderNumber || poNumber };
      }
    } catch {}
  }
  return null;
}

// ── Historical invoice storage ─────────────────────────────────────────────

async function storeHistoricalInvoice(
  db: admin.firestore.Firestore,
  venueId: string,
  invoice: InvoiceExtraction,
  rawText: string,
  ageDays: number | null,
): Promise<string> {
  const ref = await db.collection(`venues/${venueId}/historicalInvoices`).add({
    supplierName: invoice.supplierName,
    supplierPhone: invoice.supplierPhone,
    supplierEmail: invoice.supplierEmail,
    supplierAddress: invoice.supplierAddress,
    purchaseOrderNumber: invoice.purchaseOrderNumber,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    deliveryDate: invoice.deliveryDate,
    totalAmount: invoice.totalAmount,
    gstAmount: invoice.gstAmount,
    lineCount: invoice.lines.length,
    lines: invoice.lines.slice(0, 200),
    ageDays,
    rawText: rawText.slice(0, 4000),
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// ── Main callable ─────────────────────────────────────────────────────────

export const ocrInvoicePhoto = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = String(context.auth.uid || "");
    const venueId = String(data?.venueId || "");
    const imageBase64 = String(data?.imageBase64 || "");

    if (!venueId) throw new functions.https.HttpsError("invalid-argument", "venueId is required.");
    if (!imageBase64) throw new functions.https.HttpsError("invalid-argument", "imageBase64 is required.");

    const db = admin.firestore();

    const memberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    if (!memberSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "Not a member of this venue.");
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(imageBase64, "base64");
    } catch (e: any) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid imageBase64.");
    }

    const [result] = await vision.textDetection({ image: { content: buf } });
    const text =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      "";

    if (!text.trim()) {
      return { supplierName: null, invoiceNumber: null, deliveryDate: null, lines: [], rawText: "" };
    }

    // Claude extracts everything in one call
    let invoice: InvoiceExtraction | null = null;
    try {
      invoice = await extractInvoiceWithClaude(text);
    } catch (e: any) {
      console.log("[ocrInvoicePhoto] Claude extraction failed, falling back to regex", e?.message);
    }

    const rawLines = invoice?.lines?.length ? invoice.lines : extractLines(text);
    const lines = filterInvoiceLines(rawLines);

    // Determine invoice age
    const ageDays = invoiceAgeDays(invoice?.invoiceDate ?? null);
    const ageCategory = categorizeAge(ageDays);

    // Build payload
    const payload: any = {
      supplierName:        invoice?.supplierName ?? null,
      supplierPhone:       invoice?.supplierPhone ?? null,
      supplierEmail:       invoice?.supplierEmail ?? null,
      supplierAddress:     invoice?.supplierAddress ?? null,
      purchaseOrderNumber: invoice?.purchaseOrderNumber ?? null,
      invoiceNumber:       invoice?.invoiceNumber ?? null,
      invoiceDate:         invoice?.invoiceDate ?? null,
      deliveryDate:        invoice?.deliveryDate ?? null,
      totalAmount:         invoice?.totalAmount ?? null,
      gstAmount:           invoice?.gstAmount ?? null,
      lines,
      rawText: text,
      invoiceAgeCategory: ageCategory,
      historicalExplanation: null as string | null,
      matchedOrderId: null as string | null,
      matchedOrderNumber: null as string | null,
    };

    // PO → Order matching (non-blocking on error)
    if (payload.purchaseOrderNumber) {
      try {
        const match = await findAndLinkOrder(db, venueId, payload.purchaseOrderNumber);
        if (match) {
          payload.matchedOrderId = match.orderId;
          payload.matchedOrderNumber = match.orderNumber;
        }
      } catch (e: any) {
        console.log("[ocrInvoicePhoto] order matching error", e?.message);
      }
    }

    // Write invoice to venues/{venueId}/invoices regardless of age
    try {
      let invoiceDateTimestamp: admin.firestore.Timestamp | null = null;
      if (payload.invoiceDate) {
        try {
          const d = new Date(payload.invoiceDate);
          if (!isNaN(d.getTime())) invoiceDateTimestamp = admin.firestore.Timestamp.fromDate(d);
        } catch {}
      }
      const now = admin.firestore.Timestamp.now();
      const invoiceLines = lines.map((l: ParsedLine) => ({
        name: l.name,
        productName: l.name,
        qty: l.qty,
        unitCost: l.unitPrice ?? null,
        cost: l.unitPrice ?? null,
        unitPrice: l.unitPrice ?? null,
        ...(l.code ? { code: l.code } : {}),
        ...(l.total != null ? { lineTotal: l.total } : {}),
        ...(l.unit ? { unit: l.unit } : {}),
      }));
      await db.collection(`venues/${venueId}/invoices`).add({
        supplierId: data?.supplierId || null,
        supplierName: payload.supplierName,
        invoiceNumber: payload.invoiceNumber,
        poNumber: payload.purchaseOrderNumber,
        invoiceDate: payload.invoiceDate,
        invoiceDateTimestamp: invoiceDateTimestamp ?? now,
        date: invoiceDateTimestamp ?? now,
        totalAmount: payload.totalAmount,
        gstAmount: payload.gstAmount,
        lines: invoiceLines,
        lineCount: invoiceLines.length,
        venueId,
        source: "ocr-photo",
        ageCategory,
        matchedOrderId: payload.matchedOrderId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: any) {
      console.warn("[ocrInvoicePhoto] invoice write error", e?.message);
    }

    // Historical routing — invoices > 3 months old go to historicalInvoices, not stock
    if (ageCategory === "historical" || ageCategory === "old" || ageCategory === "very_old") {
      try {
        await storeHistoricalInvoice(db, venueId, invoice ?? { ...payload, lines }, text, ageDays);
      } catch (e: any) {
        console.log("[ocrInvoicePhoto] historicalInvoice store error", e?.message);
      }
      payload.historicalExplanation = buildHistoricalExplanation(
        ageCategory, payload.supplierName, payload.invoiceDate, lines.length, ageDays
      );
    }

    // Contribute supplier to global directory (best-effort)
    if (payload.supplierName) {
      contributeToGlobalDirectory(db, payload.supplierName, {
        phone: payload.supplierPhone,
        email: payload.supplierEmail,
        address: payload.supplierAddress,
        addedByVenue: venueId,
      }).catch(() => {});
    }

    // Track price changes (best-effort)
    trackPriceChanges({
      venueId,
      lines,
      supplierId: data?.supplierId || "",
      supplierName: data?.supplierName || payload.supplierName || "",
      invoiceId: payload.invoiceNumber || `ocr_${Date.now()}`,
    }).catch((e: any) => console.log("[ocrInvoicePhoto] price tracking error", e?.message));

    console.log("[ocrInvoicePhoto]", {
      supplierName: payload.supplierName,
      invoiceNumber: payload.invoiceNumber,
      purchaseOrderNumber: payload.purchaseOrderNumber,
      matchedOrderId: payload.matchedOrderId,
      ageCategory,
      linesCount: lines.length,
    });

    return payload;
  });
