import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { proposeInvoiceChanges, ProposedAction } from "./priceTracking";
import { contributeToGlobalDirectory } from "./globalSuppliers";
import { filterInvoiceLines } from "./invoiceFilter";
import { resolveSupplier as resolveSupplierShared, commitSupplierResolution, SupplierMeta } from './supplierResolution';

type ParsedLine = {
  name: string;
  qty: number;
  unitPrice?: number;
  code?: string;
  total?: number;
  unit?: string;
  caseSize?: number;
  pricePerCase?: number;
  source?: string;
};

// Regex fallback for line items when Claude fails.
// Tries to distinguish unit price from line total by verifying unitPrice × qty ≈ lineTotal.
// Returns unitPrice: undefined rather than guess when it cannot be verified.
function extractLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const raw of lines) {
    const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
    const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
    if (Number.isNaN(qty) || qty <= 0) continue;

    // Collect all price-like numbers on this line
    const priceNums = Array.from(raw.matchAll(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)/g))
      .map(m => Number(m[1]))
      .filter(n => !isNaN(n) && n > 0);
    if (priceNums.length === 0) continue;

    let unitPrice: number | undefined;
    if (priceNums.length === 1) {
      unitPrice = priceNums[0];
    } else {
      // Multiple numbers — find unit price where unitPrice × qty ≈ another number (line total)
      for (const candidate of priceNums) {
        const expectedTotal = candidate * qty;
        const verified = priceNums.some(
          n => n !== candidate && Math.abs(n - expectedTotal) / Math.max(expectedTotal, 0.01) < 0.05
        );
        if (verified) { unitPrice = candidate; break; }
      }
      // If unverifiable, omit price rather than guess the wrong figure
    }

    const name = raw.replace(/(\s*\$?\s*\d{1,5}(?:\.\d{1,2})?)+\s*$/, "").trim();
    if (name.length >= 3) {
      out.push({ name, qty, unitPrice, source: "regex-fallback" });
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

// Strip currency symbols/commas and parse to a positive number, undefined if invalid
function parsePrice(raw: any): number | undefined {
  if (raw == null) return undefined;
  const cleaned = String(raw).replace(/[$NZD\s,]/g, "").trim();
  const parsed = Number(cleaned);
  return isNaN(parsed) || parsed <= 0 ? undefined : parsed;
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

// ── Document classification ────────────────────────────────────────────────

const DOCUMENT_TYPES = ["TAX_INVOICE", "PACKING_SLIP", "DELIVERY_NOTE", "CREDIT_NOTE", "PURCHASE_ORDER", "UNKNOWN"] as const;

type DocumentType = typeof DOCUMENT_TYPES[number];

type ClassificationResult = {
  documentType: DocumentType;
  supplierName: string | null;
  documentReference: string | null;
  invoiceReference: string | null;
  documentDate: string | null;
  hasProductDetails: boolean;
  hasPricing: boolean;
  confidence: "high" | "medium" | "low";
};

type PackingSlipLine = {
  name: string;
  qty: number;
  unit?: string | null;
  sku?: string | null;
};

type PackingSlipExtraction = {
  supplierName: string | null;
  packingSlipRef: string | null;
  invoiceRef: string | null;
  deliveryDate: string | null;
  lines: PackingSlipLine[];
};

type DeliveryNoteExtraction = {
  courier: string | null;
  trackingNumber: string | null;
  senderName: string | null;
  packageCount: number | null;
  weight: string | null;
  deliveryDate: string | null;
};

async function classifyDocument(rawText: string): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = [
    "You are an expert at classifying NZ hospitality supplier documents (invoices, packing slips, delivery notes, credit notes, purchase orders).",
    "Read the document text and return ONLY valid JSON, no markdown, with this shape:",
    JSON.stringify({
      documentType: "one of TAX_INVOICE, PACKING_SLIP, DELIVERY_NOTE, CREDIT_NOTE, PURCHASE_ORDER, UNKNOWN",
      supplierName: "string or null — the vendor/supplier company name",
      documentReference: "string or null — packing slip number, delivery note number, or similar document reference",
      invoiceReference: "string or null — an invoice number referenced on this document, if shown",
      documentDate: "string or null — YYYY-MM-DD format preferred",
      hasProductDetails: "boolean — true if the document lists products/items with quantities",
      hasPricing: "boolean — true if the document shows prices/costs for items",
      confidence: "high, medium or low",
    }),
    "",
    "Classification guide:",
    "- TAX_INVOICE: a supplier invoice/tax invoice showing items, quantities AND prices, with a total amount and GST.",
    "- PACKING_SLIP: a delivery/packing slip listing items and quantities received, usually WITHOUT prices. Often headed 'Packing Slip', 'Delivery Slip', 'Goods Received', 'Picking Slip'.",
    "- DELIVERY_NOTE: a courier/freight delivery docket with NO product details — just sender, tracking number, package count. Headed 'Delivery Note', 'Consignment Note', or a courier company name (e.g. NZ Couriers, PBT, Mainfreight, Aramex).",
    "- CREDIT_NOTE: a credit note / return document, usually headed 'Credit Note' or showing negative amounts.",
    "- PURCHASE_ORDER: a purchase order issued BY the venue TO a supplier (not yet fulfilled).",
    "- UNKNOWN: cannot confidently classify.",
    "",
    "If the document type is ambiguous, set confidence to 'low' or 'medium' rather than guessing 'high'.",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: "Classify this document:\n\n" + rawText.slice(0, 4000) }],
    }),
  });

  if (!resp.ok) throw new Error("Claude classification error: " + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  const documentType: DocumentType = DOCUMENT_TYPES.includes(parsed.documentType) ? parsed.documentType : "UNKNOWN";

  return {
    documentType,
    supplierName: parsed.supplierName ? String(parsed.supplierName).trim() : null,
    documentReference: parsed.documentReference ? String(parsed.documentReference).trim() : null,
    invoiceReference: parsed.invoiceReference ? String(parsed.invoiceReference).trim() : null,
    documentDate: parsed.documentDate ? String(parsed.documentDate).trim() : null,
    hasProductDetails: !!parsed.hasProductDetails,
    hasPricing: !!parsed.hasPricing,
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
  };
}

async function extractPackingSlip(rawText: string): Promise<PackingSlipExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = [
    "You are an expert at reading NZ hospitality supplier packing slips / delivery slips.",
    "Extract the following from this packing slip text and return ONLY valid JSON, no markdown:",
    JSON.stringify({
      supplierName: "string or null — the supplier/vendor company name",
      packingSlipRef: "string or null — the packing slip / delivery slip number",
      invoiceRef: "string or null — an invoice number referenced on this slip, if shown",
      deliveryDate: "string or null — YYYY-MM-DD format preferred",
      lines: [{ productName: "product name", qty: 1, unit: "ea or null", sku: "item code or null" }],
    }),
    "",
    "Line item rules:",
    "- productName: clean product name without extra whitespace",
    "- qty: numeric quantity delivered — a plain integer or decimal, NEVER a dollar amount",
    "- unit: unit of measure (ea, kg, L, case) if shown, null otherwise",
    "- sku: supplier item code if visible, null otherwise",
    "- Only include lines with a positive quantity and a recognisable product name",
    "- SKIP header rows, totals, signatures, and lines that are just numbers or dates",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: "Extract packing slip data from this text:\n\n" + rawText.slice(0, 8000) }],
    }),
  });

  if (!resp.ok) throw new Error("Claude packing slip error: " + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  const lines: PackingSlipLine[] = Array.isArray(parsed.lines)
    ? parsed.lines
        .filter((l: any) => l && l.productName && Number(l.qty) > 0)
        .map((l: any) => ({
          name: String(l.productName).trim(),
          qty: Number(l.qty),
          unit: l.unit ? String(l.unit).trim() : null,
          sku: l.sku ? String(l.sku).trim() : null,
        }))
    : [];

  return {
    supplierName: parsed.supplierName ? String(parsed.supplierName).trim() : null,
    packingSlipRef: parsed.packingSlipRef ? String(parsed.packingSlipRef).trim() : null,
    invoiceRef: parsed.invoiceRef ? String(parsed.invoiceRef).trim() : null,
    deliveryDate: parsed.deliveryDate ? String(parsed.deliveryDate).trim() : null,
    lines,
  };
}

async function extractDeliveryNote(rawText: string): Promise<DeliveryNoteExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = [
    "You are an expert at reading NZ courier/freight delivery notes (NZ Couriers, PBT, Mainfreight, Aramex, NZ Post, etc).",
    "Extract the following from this delivery note text and return ONLY valid JSON, no markdown:",
    JSON.stringify({
      courier: "string or null — the courier/freight company name",
      trackingNumber: "string or null — tracking/consignment number",
      senderName: "string or null — the sender/origin company name",
      packageCount: "number or null — number of packages/items",
      weight: "string or null — total weight if shown, e.g. '12.5kg'",
      deliveryDate: "string or null — YYYY-MM-DD format preferred",
    }),
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: "Extract delivery note data from this text:\n\n" + rawText.slice(0, 4000) }],
    }),
  });

  if (!resp.ok) throw new Error("Claude delivery note error: " + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  return {
    courier: parsed.courier ? String(parsed.courier).trim() : null,
    trackingNumber: parsed.trackingNumber ? String(parsed.trackingNumber).trim() : null,
    senderName: parsed.senderName ? String(parsed.senderName).trim() : null,
    packageCount: Number.isFinite(Number(parsed.packageCount)) ? Number(parsed.packageCount) : null,
    weight: parsed.weight ? String(parsed.weight).trim() : null,
    deliveryDate: parsed.deliveryDate ? String(parsed.deliveryDate).trim() : null,
  };
}

// ── Claude-powered full invoice extraction ────────────────────────────────

type InvoiceExtraction = {
  supplierName: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  supplierAddress: string | null;
  supplierAccountNumber: string | null;
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
      supplierAccountNumber: "string or null — the customer account number shown on this invoice (may be labelled Account No, Account Number, Customer No, Client No)",
      purchaseOrderNumber: "string or null — may be labelled PO#, PO Number, Order No, Our Order, Reference, Ref, Your Order. This is the BUYER's order number.",
      invoiceNumber: "string or null — the supplier's invoice number",
      invoiceDate: "string or null — YYYY-MM-DD format preferred",
      deliveryDate: "string or null — delivery date if different from invoice date",
      totalAmount: "number or null — total inc GST",
      gstAmount: "number or null",
      lines: [{ name: "product name", code: "item code or null", qty: 1, unitPrice: 0, total: 0, unit: "ea or null", caseSize: null, pricePerCase: null }],
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
    "- unitPrice: price per SINGLE UNIT in NZD excluding GST. NZ hospitality invoices (Bidfood, Gilmours, Lion, DB, Hancocks) show ex-GST prices — use the ex-GST figure. If only an inc-GST price is visible, divide by 1.15. If the invoice shows a case price, divide by caseSize to get unit price (e.g. $42.00 for a 24-pack ÷ 24 = $1.75/unit). Return as a plain number only, no $ symbol. null if not found.",
    "- caseSize: units per case if this is a case-priced line (e.g. 24 for a 24-pack), null if priced per unit",
    "- pricePerCase: case price exactly as shown on the invoice (e.g. 42.00), null if priced per unit",
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
    ? parsed.lines.filter((l: any) => l && l.name && Number(l.qty) > 0).map((l: any) => {
        const rawCaseSize = l.caseSize != null && Number(l.caseSize) > 0 ? Number(l.caseSize) : undefined;
        const rawPricePerCase = parsePrice(l.pricePerCase);
        const directUnitPrice = parsePrice(l.unitPrice);
        // Derive unit price from case price if direct unit price not provided
        const rawUnitPrice = directUnitPrice !== undefined
          ? directUnitPrice
          : (rawPricePerCase != null && rawCaseSize != null)
            ? rawPricePerCase / rawCaseSize
            : undefined;
        return {
          name: String(l.name).trim(),
          qty: Number(l.qty),
          unitPrice: rawUnitPrice,
          code: l.code ? String(l.code).trim() : undefined,
          total: l.total != null ? Number(l.total) : undefined,
          unit: l.unit ? String(l.unit).trim() : undefined,
          caseSize: rawCaseSize,
          pricePerCase: rawPricePerCase,
        };
      })
    : [];

  return {
    supplierName: parsed.supplierName ? String(parsed.supplierName).trim() : null,
    supplierPhone: parsed.supplierPhone ? String(parsed.supplierPhone).trim() : null,
    supplierEmail: parsed.supplierEmail ? String(parsed.supplierEmail).trim() : null,
    supplierAddress: parsed.supplierAddress ? String(parsed.supplierAddress).trim() : null,
    supplierAccountNumber: parsed.supplierAccountNumber ? String(parsed.supplierAccountNumber).trim() : null,
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

// ── Inline matching helpers (Admin SDK — cannot import client-side matching.ts) ──

function normNameInline(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function tokenJaccardInline(a: string, b: string): number {
  const ta = new Set(normNameInline(a).split(" ").filter(Boolean));
  const tb = new Set(normNameInline(b).split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / (ta.size + tb.size - intersection);
}

// ── Unpriced product creation ─────────────────────────────────────────────────

async function processUnpricedLines(
  db: admin.firestore.Firestore,
  venueId: string,
  unpricedLines: ParsedLine[],
  supplierId: string | null,
  supplierName: string | null,
  invoiceId: string,
): Promise<ProposedAction[]> {
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const existingProds = productsSnap.docs.map(d => ({
    id: d.id,
    name: (d.data() as any).name || "",
    supplierId: (d.data() as any).supplierId || null,
  }));
  const newProposals: ProposedAction[] = [];
  for (const line of unpricedLines) {
    if (!line.name?.trim()) continue;
    const matchedProd = existingProds.find(ep => {
      const en = normNameInline(ep.name);
      const cn = normNameInline(line.name);
      return (en === cn && en.length > 0) || tokenJaccardInline(line.name, ep.name) >= 0.85;
    });
    if (matchedProd) {
      if (!matchedProd.supplierId && supplierId) {
        await db.doc(`venues/${venueId}/products/${matchedProd.id}`).update({
          supplierId,
          supplierName,
          supplierUpdatedAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }
      continue;
    }
    // Genuinely new — surface as proposal rather than auto-creating
    newProposals.push({
      id: `${invoiceId}:newProduct:${line.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      type: 'newProduct',
      lineName: line.name.trim(),
      unitPrice: null,
      qty: line.qty,
      caseSize: line.caseSize != null && line.caseSize > 0 ? line.caseSize : null,
      supplierId: supplierId || null,
      supplierName: supplierName || null,
    });
  }
  return newProposals;
}


// ── Stock increment helper — goods always increment stock on arrival ──────────

async function incrementStockFromLines(
  db: admin.firestore.Firestore,
  venueId: string,
  lines: Array<{ productId?: string | null; name?: string | null; qty: number }>,
  uid: string,
): Promise<number> {
  if (!lines.length) return 0;

  const byProductId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const l of lines) {
    if (!l.qty) continue;
    if (l.productId) byProductId.set(l.productId, (byProductId.get(l.productId) || 0) + l.qty);
    else if (l.name) byName.set(normNameInline(l.name), (byName.get(normNameInline(l.name)) || 0) + l.qty);
  }
  if (byProductId.size === 0 && byName.size === 0) return 0;

  const venueDoc = await db.doc(`venues/${venueId}`).get();
  const isFestival = venueDoc.data()?.venueType === 'festival';
  const stocktakeActive = !isFestival && !!(venueDoc.data()?.stocktakeActive);
  const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
  const batch = db.batch();
  let updates = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const deptDoc of deptsSnap.docs) {
    const areasSnap = await deptDoc.ref.collection("areas").get();
    for (const areaDoc of areasSnap.docs) {
      const itemsSnap = await areaDoc.ref.collection("items").get();
      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data() as any;
        const linkId = item.productId || item.productLinkId || null;
        let qty: number | undefined;
        if (linkId && byProductId.has(linkId)) {
          qty = byProductId.get(linkId);
        } else {
          const itemName = normNameInline(item.name || "");
          if (itemName && byName.has(itemName)) qty = byName.get(itemName);
        }
        if (qty) {
          if (isFestival) {
            batch.update(itemDoc.ref, {
              lastCount: admin.firestore.FieldValue.increment(qty),
              lastCountAt: now,
              lastCountBy: uid,
              updatedAt: now,
            });
            updates++;
          } else if (stocktakeActive) {
            // Queue for post-stocktake application
            const pathParts = itemDoc.ref.path.split('/');
            const deptId = pathParts[3];
            const areaId = pathParts[5];
            await db.collection(`venues/${venueId}/queuedInvoices`).add({
              itemId: itemDoc.id,
              departmentId: deptId,
              areaId: areaId,
              qty,
              source: 'photo-invoice',
              queuedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            batch.update(itemDoc.ref, {
              incomingQty: admin.firestore.FieldValue.increment(qty),
              lastCountBy: uid,
              updatedAt: now,
            });
            updates++;
          }
        }
      }
    }
  }

  if (updates > 0) await batch.commit();
  return updates;
}

// ── Packing slip line matching ─────────────────────────────────────────────

async function matchPackingSlipLines(
  db: admin.firestore.Firestore,
  venueId: string,
  lines: PackingSlipLine[],
  uid: string,
): Promise<{ processedLines: any[]; unmatchedLines: any[]; totalProvisionalCost: number }> {
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const processedLines: any[] = [];
  const unmatchedLines: any[] = [];
  let totalProvisionalCost = 0;

  for (const line of lines) {
    const lineNorm = normNameInline(line.name);
    const matchedProduct = products.find(p => {
      const pn = normNameInline(p.name || "");
      return (pn === lineNorm && pn.length > 0) || tokenJaccardInline(line.name, p.name || "") >= 0.85;
    });

    const unitCost = matchedProduct?.costPrice != null ? Number(matchedProduct.costPrice) : 0;
    const lineTotal = unitCost * line.qty;
    totalProvisionalCost += lineTotal;

    const processed = {
      productId: matchedProduct?.id || null,
      name: line.name,
      productName: line.name,
      qty: line.qty,
      unit: line.unit || null,
      sku: line.sku || null,
      unitCost,
      lineTotal,
      provisionalCost: true,
      matched: !!matchedProduct,
    };
    processedLines.push(processed);
    if (!matchedProduct) unmatchedLines.push(processed);
  }

  await incrementStockFromLines(
    db, venueId,
    processedLines.map(l => ({ productId: l.productId, name: l.name, qty: l.qty })),
    uid,
  );

  return { processedLines, unmatchedLines, totalProvisionalCost };
}

// ── Late invoice detection (invoice dated inside an already-closed cycle) ─────

async function checkLateInvoice(
  db: admin.firestore.Firestore,
  venueId: string,
  invoiceDateStr: string | null,
): Promise<{ isLate: boolean; cycleEndDate: string | null }> {
  if (!invoiceDateStr) return { isLate: false, cycleEndDate: null };
  const invDate = new Date(invoiceDateStr);
  if (isNaN(invDate.getTime())) return { isLate: false, cycleEndDate: null };

  let latestCompleted: Date | null = null;
  const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
  for (const deptDoc of deptsSnap.docs) {
    const snapSnap = await deptDoc.ref.collection("snapshots").orderBy("completedAt", "desc").limit(1).get();
    if (snapSnap.empty) continue;
    const completedAt = (snapSnap.docs[0].data() as any).completedAt;
    const d: Date | null = completedAt?.toDate ? completedAt.toDate() : null;
    if (d && (!latestCompleted || d > latestCompleted)) latestCompleted = d;
  }

  if (!latestCompleted) return { isLate: false, cycleEndDate: null };
  const isLate = invDate <= latestCompleted;
  return { isLate, cycleEndDate: latestCompleted.toISOString().split("T")[0] };
}

// ── Pending delivery matching ──────────────────────────────────────────────

async function findPendingDeliveryMatch(
  db: admin.firestore.Firestore,
  venueId: string,
  supplierName: string | null,
  invoiceNumber: string | null,
  invoiceDateStr: string | null,
): Promise<{ delivery: { id: string; data: any } | null; confidence: "high" | "medium" | "none" }> {
  const pendingSnap = await db.collection(`venues/${venueId}/pendingDeliveries`)
    .where("status", "==", "awaiting_invoice")
    .get();
  if (pendingSnap.empty) return { delivery: null, confidence: "none" };

  let mediumMatch: { id: string; data: any } | null = null;

  for (const d of pendingSnap.docs) {
    const data = d.data() as any;

    if (invoiceNumber && data.invoiceRef && String(data.invoiceRef).trim() === String(invoiceNumber).trim()) {
      return { delivery: { id: d.id, data }, confidence: "high" };
    }

    if (!mediumMatch && supplierName && data.supplierName && normNameInline(data.supplierName) === normNameInline(supplierName)) {
      if (data.deliveryDate && invoiceDateStr) {
        const dDate = new Date(data.deliveryDate);
        const iDate = new Date(invoiceDateStr);
        if (!isNaN(dDate.getTime()) && !isNaN(iDate.getTime())) {
          const diffDays = Math.abs(iDate.getTime() - dDate.getTime()) / 86400000;
          if (diffDays <= 7) mediumMatch = { id: d.id, data };
        }
      }
    }
  }

  if (mediumMatch) return { delivery: mediumMatch, confidence: "medium" };
  return { delivery: null, confidence: "none" };
}

async function confirmDeliveryMatch(
  db: admin.firestore.Firestore,
  venueId: string,
  deliveryId: string,
  invoiceId: string,
  invoiceLines: Array<{ productId?: string | null; unitPrice?: number | null }>,
): Promise<void> {
  await db.doc(`venues/${venueId}/pendingDeliveries/${deliveryId}`).update({
    status: "invoice_confirmed",
    invoiceId,
    costConfirmed: true,
    confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const updates = invoiceLines
    .filter(l => l.productId && l.unitPrice)
    .map(line => db.doc(`venues/${venueId}/products/${line.productId}`).update({
      costPrice: line.unitPrice,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {}));
  await Promise.all(updates);
}

// ── Document handlers ──────────────────────────────────────────────────────

async function handleTaxInvoice(
  db: admin.firestore.Firestore,
  venueId: string,
  uid: string,
  text: string,
  data: any,
): Promise<any> {
  let invoice: InvoiceExtraction | null = null;
  try {
    invoice = await extractInvoiceWithClaude(text);
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] Claude extraction failed, falling back to regex", e?.message);
  }

  const rawLines = invoice?.lines?.length ? invoice.lines : extractLines(text);
  const lines = filterInvoiceLines(rawLines);

  const ageDays = invoiceAgeDays(invoice?.invoiceDate ?? null);
  const ageCategory = categorizeAge(ageDays);

  if (ageCategory === "current" || ageCategory === "late") {
    const { isLate, cycleEndDate } = await checkLateInvoice(db, venueId, invoice?.invoiceDate ?? null);
    if (isLate) {
      return {
        ok: true,
        documentType: "TAX_INVOICE" as DocumentType,
        isLateInvoice: true,
        invoiceDate: invoice?.invoiceDate ?? null,
        cycleEndDate,
        invoiceData: {
          invoice, lines, ageCategory, rawText: text,
          purchaseOrderNumber: invoice?.purchaseOrderNumber ?? null,
        },
        options: [
          { id: "apply_current", label: "Apply to current cycle", description: "Invoice received today, applied to current period. Recommended." },
          { id: "hold_for_review", label: "Hold for manager review", description: "Flag this for your manager to decide." },
        ],
        message: "This invoice is dated within a stocktake period that has already been completed.",
      };
    }
  }

  return await processTaxInvoice(db, venueId, uid, invoice, lines, text, ageCategory, data, null);
}

async function processTaxInvoice(
  db: admin.firestore.Firestore,
  venueId: string,
  uid: string,
  invoice: InvoiceExtraction | null,
  lines: ParsedLine[],
  text: string,
  ageCategory: AgeCategory,
  data: any,
  lateInvoiceDecision: string | null,
): Promise<any> {
  const ageDays = invoiceAgeDays(invoice?.invoiceDate ?? null);

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
    priceChanges: [] as any[],
    hasPriceChanges: false,
    proposals: [] as ProposedAction[],
    documentType: "TAX_INVOICE" as DocumentType,
    ok: true,
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

  // Resolve supplier FIRST so invoice document has the correct supplierId
  const ocrMeta: SupplierMeta = {
    name: payload.supplierName || "",
    phone: payload.supplierPhone || null,
    email: payload.supplierEmail || null,
    address: payload.supplierAddress || null,
    accountNumber: invoice?.supplierAccountNumber || null,
  };
  let resolvedSupplierId: string = data?.supplierId || "";
  let resolvedSupplierName = "";
  let supplierCandidate: { name: string; phone: string|null; email: string|null; address: string|null; accountNumber: string|null } | undefined;
  if (ocrMeta.name) {
    const resolution = await resolveSupplierShared(db, venueId, ocrMeta);
    if (resolution.kind === 'matched') {
      const committed = await commitSupplierResolution(db, venueId, resolution, ocrMeta, 'invoice-scan');
      resolvedSupplierId = committed.supplierId;
      resolvedSupplierName = committed.supplierName;
    } else {
      supplierCandidate = {
        name: ocrMeta.name,
        phone: ocrMeta.phone,
        email: ocrMeta.email,
        address: ocrMeta.address,
        accountNumber: ocrMeta.accountNumber,
      };
    }
  }

  // ── Duplicate invoice check ─────────────────────────────────────────────────
  if (payload.invoiceNumber) {
    try {
      const existingSnap = await db.collection(`venues/${venueId}/invoices`)
        .where('invoiceNumber', '==', payload.invoiceNumber)
        .where('supplierId', '==', resolvedSupplierId || '')
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0].data() as any;
        const existingDate = existing.invoiceDate || existing.date?.toDate?.()?.toISOString?.()?.slice(0, 10) || 'unknown date';
        return {
          ok: false,
          duplicate: true,
          duplicateInvoiceId: existingSnap.docs[0].id,
          existingDate,
          message: `This invoice (${payload.invoiceNumber}) was already processed on ${existingDate}. If this is a new invoice, check the invoice number.`,
          supplierName: resolvedSupplierName || payload.supplierName,
          invoiceNumber: payload.invoiceNumber,
        };
      }
    } catch (e: any) {
      console.log('[ocrInvoicePhoto] duplicate check error — proceeding', e?.message);
      // Non-fatal — proceed with processing if check fails
    }
  }

  // Write invoice to venues/{venueId}/invoices with resolved supplierId
  let invoiceDocId: string | undefined;
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
      ...(l.caseSize ? { caseSize: l.caseSize } : {}),
      ...(l.pricePerCase ? { pricePerCase: l.pricePerCase } : {}),
      ...(l.source ? { source: l.source } : {}),
    }));
    const invoiceRef = await db.collection(`venues/${venueId}/invoices`).add({
      supplierId: resolvedSupplierId || null,
      supplierName: resolvedSupplierName || payload.supplierName || null,
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
      pricesExGST: true,
      gstRate: 0.15,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(lateInvoiceDecision ? { lateInvoiceHandling: lateInvoiceDecision } : {}),
    });
    invoiceDocId = invoiceRef.id;
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

  // Propose price changes — auto-writes (touches + initial prices) committed immediately;
  // price changes and new products surfaced as proposals for user review
  const invoiceId = payload.invoiceNumber || `ocr_${Date.now()}`;
  let productMap: Record<string, string> = {};
  try {
    const priceResult = await proposeInvoiceChanges({
      venueId,
      lines,
      supplierId: resolvedSupplierId,
      supplierName: resolvedSupplierName || data?.supplierName || payload.supplierName || "",
      invoiceId,
      invoiceDocId,
    });
    productMap = priceResult.autoProductMap || {};
    payload.proposals = payload.proposals.concat(priceResult.proposals);
    payload.hasPriceChanges = priceResult.proposals.some((p: ProposedAction) => p.type === 'priceChange');

    // Link confidently-matched productIds back into the saved invoice line items immediately
    if (invoiceDocId && Object.keys(productMap).length > 0) {
      try {
        const invRef = db.doc(`venues/${venueId}/invoices/${invoiceDocId}`);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          const updatedLines = ((invSnap.data() as any).lines || []).map((il: any) => {
            const pid = productMap[il.name] || productMap[il.productName];
            return pid ? { ...il, productId: pid } : il;
          });
          await invRef.update({ lines: updatedLines });
        }
      } catch (e: any) {
        console.log("[ocrInvoicePhoto] invoice product link error", e?.message);
      }
    }
  } catch (e: any) {
    console.error("[ocrInvoicePhoto] price tracking failed:", e?.message);
    // Non-fatal — invoice was saved correctly but product costPrice may not have updated
  }

  // Propose new products for genuinely new unpriced lines; auto-backfill supplierId on existing matches
  const unpricedLines = lines.filter((l: ParsedLine) => !(l.unitPrice != null && (l.unitPrice as number) > 0));
  if (unpricedLines.length > 0) {
    try {
      const unpricedProposals = await processUnpricedLines(
        db, venueId, unpricedLines,
        resolvedSupplierId || null, resolvedSupplierName || null,
        invoiceId,
      );
      if (unpricedProposals.length > 0) {
        payload.proposals = payload.proposals.concat(unpricedProposals);
      }
    } catch (error: any) {
      console.error("[ocrInvoice] unpriced product processing failed:", error?.message);
    }
  }

  // Track price extraction failures per supplier
  const hadPriceFailure = unpricedLines.length > 0 && lines.length > 0;
  let documentStoragePath: string | null = null;
  let shouldRequestInvoice = false;

  if (hadPriceFailure) {
    if (data?.imageBase64) {
      try {
        const imgBuf = Buffer.from(String(data.imageBase64), 'base64');
        const storageKey = `venues/${venueId}/invoice-failures/${Date.now()}-${invoiceDocId || 'unknown'}.jpg`;
        await admin.storage().bucket().file(storageKey).save(imgBuf, { contentType: 'image/jpeg' });
        documentStoragePath = storageKey;
      } catch (e: any) {
        console.warn('[ocrInvoicePhoto] failure image storage error', e?.message);
      }
    }
    try {
      await db.collection(`venues/${venueId}/priceExtractionFailures`).add({
        supplierName: resolvedSupplierName || 'Unknown',
        invoiceId: invoiceDocId || null,
        documentStoragePath,
        linesMissingPrice: unpricedLines.length,
        totalLines: lines.length,
        reportedToSupport: false,
        occurredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: any) {
      console.warn('[ocrInvoicePhoto] failure tracking write error', e?.message);
    }
    if (resolvedSupplierName) {
      try {
        const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        );
        const recentSnap = await db
          .collection(`venues/${venueId}/priceExtractionFailures`)
          .where('supplierName', '==', resolvedSupplierName)
          .where('occurredAt', '>=', thirtyDaysAgo)
          .get();
        shouldRequestInvoice = recentSnap.docs.length >= 3;
      } catch (e: any) {
        console.warn('[ocrInvoicePhoto] failure count query error', e?.message);
      }
    }
  }

  // Stock is always incremented when goods arrive — cost is confirmed separately
  try {
    const stockLines = lines.map((l: ParsedLine) => ({ productId: productMap[l.name] || null, name: l.name, qty: l.qty }));
    const updates = await incrementStockFromLines(db, venueId, stockLines, uid);
    payload.stockIncremented = updates > 0;
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] stock increment error", e?.message);
    payload.stockIncremented = false;
  }

  // Try to match this invoice to a pending delivery (packing slip / delivery note awaiting invoice)
  try {
    const { delivery, confidence } = await findPendingDeliveryMatch(
      db, venueId, resolvedSupplierName || payload.supplierName, payload.invoiceNumber, payload.invoiceDate,
    );
    if (confidence === "high" && delivery && invoiceDocId) {
      const invoiceLinesForMatch = lines.map((l: ParsedLine) => ({ productId: productMap[l.name] || null, unitPrice: l.unitPrice ?? null }));
      await confirmDeliveryMatch(db, venueId, delivery.id, invoiceDocId, invoiceLinesForMatch);
      payload.matched = true;
      payload.matchConfidence = "high";
      payload.deliveryId = delivery.id;
      payload.message = "Invoice processed and matched to a pending delivery. Costs confirmed.";
    } else if (confidence === "medium" && delivery) {
      payload.matched = true;
      payload.matchConfidence = "medium";
      payload.deliveryId = delivery.id;
      payload.deliverySummary = {
        supplierName: delivery.data.supplierName ?? null,
        deliveryDate: delivery.data.deliveryDate ?? null,
        lineCount: Array.isArray(delivery.data.lines) ? delivery.data.lines.length : 0,
        packingSlipRef: delivery.data.packingSlipRef ?? null,
      };
      payload.message = "Invoice processed. We found a possible matching delivery — please confirm.";
    } else {
      payload.message = "Invoice processed. No matching delivery found.";
    }
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] delivery matching error", e?.message);
    payload.message = "Invoice processed.";
  }

  // ── PO cross-reference against open orders ──────────────────────────────────
  // Gated on !payload.matchedOrderId too, not just !payload.matched — findAndLinkOrder
  // (above) may have already matched this invoice's PO/reference number to an order
  // and flipped its status to "invoiced". Without this check, that already-matched
  // invoice would still fall through to the retro/informal-order branch below and
  // create a spurious duplicate order for an invoice that's already correctly linked.
  if (!payload.matched && !payload.matchedOrderId) {
    try {
      let matchedOrderId: string | null = null;
      let matchConfidence: 'po-exact' | 'supplier-fuzzy' | 'none' = 'none';

      // Step 1: Try exact PO number match
      if (payload.purchaseOrderNumber) {
        const poSnap = await db.collection(`venues/${venueId}/orders`)
          .where('poNumber', '==', payload.purchaseOrderNumber)
          .where('status', 'in', ['submitted', 'placed', 'dispatched'])
          .limit(1)
          .get();
        if (!poSnap.empty) {
          matchedOrderId = poSnap.docs[0].id;
          matchConfidence = 'po-exact';
        }
      }

      // Step 2: Fuzzy supplier + recent date match (within 14 days)
      if (!matchedOrderId && resolvedSupplierId) {
        const supplierOrdersSnap = await db.collection(`venues/${venueId}/orders`)
          .where('supplierId', '==', resolvedSupplierId)
          .where('status', 'in', ['submitted', 'placed', 'dispatched'])
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();
        if (!supplierOrdersSnap.empty && payload.invoiceDate) {
          const invoiceMs = new Date(payload.invoiceDate).getTime();
          for (const orderDoc of supplierOrdersSnap.docs) {
            const orderData = orderDoc.data() as any;
            const orderMs = orderData.createdAt?.toMillis?.() || 0;
            if (orderMs && Math.abs(invoiceMs - orderMs) <= 14 * 86400000) {
              matchedOrderId = orderDoc.id;
              matchConfidence = 'supplier-fuzzy';
              break;
            }
          }
        }
      }

      if (matchedOrderId) {
        // Link invoice to the matched order
        payload.matchedOrderId = matchedOrderId;
        payload.matchConfidence = matchConfidence;
        payload.matched = true;
        payload.message = matchConfidence === 'po-exact'
          ? 'Invoice matched to an existing order by PO number.'
          : 'Invoice matched to a recent order from this supplier.';
        // Update the order status to received
        await db.doc(`venues/${venueId}/orders/${matchedOrderId}`).update({
          status: 'received',
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          invoiceId: invoiceDocId || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // No match found — create a retrospective order record
        // This handles: informal phone orders, rep walk-ins, new suppliers, any order placed outside Hosti
        const retroOrder = await db.collection(`venues/${venueId}/orders`).add({
          supplierId: resolvedSupplierId || null,
          supplierName: resolvedSupplierName || payload.supplierName || null,
          status: 'received',
          source: 'invoice-scan',
          informal: true,  // Flag — this order was never placed in Hosti
          poNumber: payload.purchaseOrderNumber || null,
          invoiceNumber: payload.invoiceNumber || null,
          invoiceId: invoiceDocId || null,
          totalAmount: payload.totalAmount || null,
          lines: lines.map((l: ParsedLine) => ({
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice ?? null,
            unit: l.unit || null,
          })),
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          venueId,
          notes: 'Created automatically from invoice scan — order was placed outside Hosti.',
        });
        payload.matchedOrderId = retroOrder.id;
        payload.matched = true;
        payload.retroOrder = true;
        payload.message = payload.message?.includes('No matching delivery')
          ? 'Invoice processed. A delivery record has been created — this order was placed outside Hosti.'
          : payload.message;
      }
    } catch (e: any) {
      console.log("[ocrInvoicePhoto] PO match / retro order error", e?.message);
      // Non-fatal — invoice processing continues regardless
    }
  }

  // Backfill the invoice doc with whatever matchedOrderId was resolved above — the
  // doc was already written earlier (before this matching ran), so its matchedOrderId
  // field would otherwise stay stale/null for matches found here.
  if (payload.matchedOrderId && invoiceDocId) {
    await db.doc(`venues/${venueId}/invoices/${invoiceDocId}`).update({
      matchedOrderId: payload.matchedOrderId,
      informal: payload.retroOrder || false,
    }).catch(() => {});  // non-fatal
  }

  console.log("[ocrInvoicePhoto]", {
    supplierName: payload.supplierName,
    invoiceNumber: payload.invoiceNumber,
    purchaseOrderNumber: payload.purchaseOrderNumber,
    matchedOrderId: payload.matchedOrderId,
    ageCategory,
    linesCount: lines.length,
  });

  payload.priceExtractionIssue = hadPriceFailure;
  payload.requestInvoiceCopy = shouldRequestInvoice;
  payload.failureSupplier = shouldRequestInvoice ? (resolvedSupplierName || null) : null;
  payload.documentStorageRef = shouldRequestInvoice ? documentStoragePath : null;
  payload.supplierId = resolvedSupplierId || null;
  payload.invoiceDocId = invoiceDocId || null;
  if (supplierCandidate) {
    payload.supplierCandidate = supplierCandidate;
  }
  return payload;
}

async function handlePackingSlip(
  db: admin.firestore.Firestore,
  venueId: string,
  uid: string,
  text: string,
): Promise<any> {
  const slip = await extractPackingSlip(text);
  const slipMeta: SupplierMeta = {
    name: slip.supplierName || "",
    phone: null,
    email: null,
    address: null,
    accountNumber: null,
  };
  let supplierId = "";
  let supplierName = "";
  if (slipMeta.name) {
    const resolution = await resolveSupplierShared(db, venueId, slipMeta);
    const committed = await commitSupplierResolution(db, venueId, resolution, slipMeta, 'invoice-scan');
    supplierId = committed.supplierId;
    supplierName = committed.supplierName;
  }
  const { processedLines, unmatchedLines, totalProvisionalCost } = await matchPackingSlipLines(db, venueId, slip.lines, uid);

  const deliveryRef = await db.collection(`venues/${venueId}/pendingDeliveries`).add({
    type: "packing_slip",
    status: "awaiting_invoice",
    supplierName: supplierName || slip.supplierName || null,
    supplierId: supplierId || null,
    packingSlipRef: slip.packingSlipRef,
    invoiceRef: slip.invoiceRef,
    deliveryDate: slip.deliveryDate,
    lines: processedLines,
    invoiceId: null,
    costConfirmed: false,
    provisionalCost: totalProvisionalCost,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
    matchedOrderId: null,
  });

  return {
    ok: true,
    documentType: "PACKING_SLIP" as DocumentType,
    deliveryId: deliveryRef.id,
    stockIncremented: processedLines.length > 0,
    linesProcessed: processedLines.length,
    unmatchedLines,
    provisionalCost: totalProvisionalCost,
    supplierName: supplierName || slip.supplierName || null,
    packingSlipRef: slip.packingSlipRef,
    invoiceRef: slip.invoiceRef,
    message: "Stock received and incremented. Awaiting invoice confirmation.",
  };
}

async function handleDeliveryNote(text: string, classification: ClassificationResult): Promise<any> {
  let note: DeliveryNoteExtraction | null = null;
  try {
    note = await extractDeliveryNote(text);
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] delivery note extraction failed", e?.message);
  }

  return {
    ok: true,
    documentType: "DELIVERY_NOTE" as DocumentType,
    deliveryNoteData: {
      courier: note?.courier ?? null,
      trackingNumber: note?.trackingNumber ?? null,
      senderName: note?.senderName ?? classification.supplierName ?? null,
      packageCount: note?.packageCount ?? null,
      deliveryDate: note?.deliveryDate ?? classification.documentDate ?? null,
    },
    stockIncremented: false,
    requiresAction: true,
    actions: ["match_to_order", "manual_entry", "upload_packing_slip"],
    message: "Courier delivery note detected. No product details available. Please match to a pending order or enter received stock manually.",
  };
}

async function handleCreditNoteOcr(
  db: admin.firestore.Firestore,
  venueId: string,
  uid: string,
  text: string,
): Promise<any> {
  let invoice: InvoiceExtraction | null = null;
  try {
    invoice = await extractInvoiceWithClaude(text);
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] credit note extraction failed, falling back to regex", e?.message);
  }

  const rawLines = invoice?.lines?.length ? invoice.lines : extractLines(text);
  const positiveLines = filterInvoiceLines(rawLines);

  const creditMeta: SupplierMeta = {
    name: invoice?.supplierName || "",
    phone: invoice?.supplierPhone || null,
    email: invoice?.supplierEmail || null,
    address: invoice?.supplierAddress || null,
    accountNumber: invoice?.supplierAccountNumber || null,
  };
  let supplierId = "";
  let supplierName = "";
  if (creditMeta.name) {
    const resolution = await resolveSupplierShared(db, venueId, creditMeta);
    const committed = await commitSupplierResolution(db, venueId, resolution, creditMeta, 'invoice-scan');
    supplierId = committed.supplierId;
    supplierName = committed.supplierName;
  }

  const creditLines = positiveLines.map((l: ParsedLine) => {
    const unitCost = Math.abs(l.unitPrice ?? 0);
    const qty = -Math.abs(l.qty);
    return {
      name: l.name,
      productName: l.name,
      qty,
      unitCost,
      cost: unitCost,
      unitPrice: unitCost,
      lineTotal: qty * unitCost,
      ...(l.code ? { code: l.code } : {}),
      ...(l.unit ? { unit: l.unit } : {}),
    };
  });
  const totalAmount = creditLines.reduce((sum, l) => sum + l.lineTotal, 0);

  let invoiceId: string | undefined;
  try {
    const now = admin.firestore.Timestamp.now();
    let invoiceDateTimestamp: admin.firestore.Timestamp | null = null;
    if (invoice?.invoiceDate) {
      try {
        const d = new Date(invoice.invoiceDate);
        if (!isNaN(d.getTime())) invoiceDateTimestamp = admin.firestore.Timestamp.fromDate(d);
      } catch {}
    }
    const ref = await db.collection(`venues/${venueId}/invoices`).add({
      type: "credit_note",
      supplierId: supplierId || null,
      supplierName: supplierName || invoice?.supplierName || null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      invoiceDate: invoice?.invoiceDate ?? null,
      invoiceDateTimestamp: invoiceDateTimestamp ?? now,
      date: invoiceDateTimestamp ?? now,
      totalAmount,
      lines: creditLines,
      lineCount: creditLines.length,
      venueId,
      source: "ocr-photo",
      originalInvoiceId: null,
      status: "posted",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    invoiceId = ref.id;
  } catch (e: any) {
    console.warn("[ocrInvoicePhoto] credit note write error", e?.message);
  }

  // Reverse stock for returned items
  try {
    await incrementStockFromLines(
      db, venueId,
      creditLines.map(l => ({ name: l.name, qty: l.qty })),
      uid,
    );
  } catch (e: any) {
    console.log("[ocrInvoicePhoto] credit note stock adjustment error", e?.message);
  }

  return {
    ok: true,
    documentType: "CREDIT_NOTE" as DocumentType,
    invoiceId: invoiceId || null,
    totalAmount,
    linesProcessed: creditLines.length,
    supplierName: supplierName || invoice?.supplierName || null,
    message: "Credit note recorded — stock adjusted.",
  };
}

// ── Main callable ─────────────────────────────────────────────────────────

export const ocrInvoicePhoto = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120, secrets: ["ANTHROPIC_API_KEY"] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = String(context.auth.uid || "");
    const venueId = String(data?.venueId || "");

    if (!venueId) throw new functions.https.HttpsError("invalid-argument", "venueId is required.");

    const db = admin.firestore();

    const memberSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    if (!memberSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "Not a member of this venue.");
    }

    // Resume path 1: confirm a medium-confidence delivery match without re-running OCR
    if (data?.confirmDeliveryMatch === true && data?.deliveryId && data?.invoiceDocId) {
      const deliveryId = String(data.deliveryId);
      const invoiceDocId = String(data.invoiceDocId);
      const invSnap = await db.doc(`venues/${venueId}/invoices/${invoiceDocId}`).get();
      const invoiceLines = invSnap.exists ? ((invSnap.data() as any).lines || []) : [];
      await confirmDeliveryMatch(db, venueId, deliveryId, invoiceDocId, invoiceLines);
      return {
        ok: true,
        documentType: "TAX_INVOICE" as DocumentType,
        matched: true,
        matchConfidence: "high",
        deliveryId,
        message: "Delivery match confirmed. Product costs updated.",
      };
    }

    // Resume path 2: late invoice decision using cached extraction, no re-running OCR
    const lateInvoiceDecision = data?.lateInvoiceDecision ? String(data.lateInvoiceDecision) : null;
    const cachedInvoiceData = data?.cachedInvoiceData;
    if (lateInvoiceDecision && cachedInvoiceData) {
      return await processTaxInvoice(
        db, venueId, uid,
        cachedInvoiceData.invoice, cachedInvoiceData.lines, cachedInvoiceData.rawText || "",
        cachedInvoiceData.ageCategory, data, lateInvoiceDecision,
      );
    }

    const imageBase64 = String(data?.imageBase64 || "");
    if (!imageBase64) throw new functions.https.HttpsError("invalid-argument", "imageBase64 is required.");

    try {
      Buffer.from(imageBase64, "base64");
    } catch (e: any) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid imageBase64.");
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new functions.https.HttpsError("internal", "ANTHROPIC_API_KEY not configured.");

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 4096,
        system: "You are reading a hospitality invoice photo. Extract ALL text you can see exactly as written, preserving the layout as much as possible. Include supplier name, invoice number, date, and all line items with their quantities and prices. Do not summarise — return the full text content.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: "Extract all text from this invoice image." },
          ],
        }],
      }),
    });

    if (!claudeResp.ok) {
      const errBody = await claudeResp.json().catch(() => ({} as any));
      throw new Error(`Claude vision failed: ${claudeResp.status} ${errBody?.error?.message || ""}`);
    }
    const claudeData = await claudeResp.json() as any;
    const text = claudeData?.content?.[0]?.text || "";

    if (!text.trim()) {
      return {
        ok: false,
        documentType: "UNKNOWN" as DocumentType,
        manualSelectionRequired: true,
        supplierName: null, invoiceNumber: null, deliveryDate: null, lines: [], rawText: "",
        message: "Could not read any text from this image. Please try again or enter details manually.",
      };
    }

    // STEP 1: classify the document (unless the client already told us what it is)
    const docTypeHint = data?.docTypeHint ? String(data.docTypeHint) : null;
    let classification: ClassificationResult;
    if (docTypeHint && DOCUMENT_TYPES.includes(docTypeHint as DocumentType) && docTypeHint !== "UNKNOWN") {
      classification = {
        documentType: docTypeHint as DocumentType,
        supplierName: null, documentReference: null, invoiceReference: null, documentDate: null,
        hasProductDetails: true, hasPricing: true, confidence: "high",
      };
    } else {
      try {
        classification = await classifyDocument(text);
      } catch (e: any) {
        console.log("[ocrInvoicePhoto] classification failed, defaulting to TAX_INVOICE", e?.message);
        classification = {
          documentType: "TAX_INVOICE", supplierName: null, documentReference: null, invoiceReference: null,
          documentDate: null, hasProductDetails: true, hasPricing: true, confidence: "low",
        };
      }
    }

    console.log("[ocrInvoicePhoto] classification", classification);

    // STEP 2: route based on document type
    switch (classification.documentType) {
      case "PACKING_SLIP":
        return await handlePackingSlip(db, venueId, uid, text);
      case "DELIVERY_NOTE":
        return await handleDeliveryNote(text, classification);
      case "CREDIT_NOTE":
        return await handleCreditNoteOcr(db, venueId, uid, text);
      case "TAX_INVOICE":
        return await handleTaxInvoice(db, venueId, uid, text, data);
      case "PURCHASE_ORDER":
      case "UNKNOWN":
      default:
        return {
          ok: false,
          documentType: classification.documentType,
          manualSelectionRequired: true,
          supplierName: classification.supplierName,
          message: "Could not confidently identify this document type. Please select the document type manually.",
        };
    }
  });
