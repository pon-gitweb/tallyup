/**
 * Tests for the stale-invoice protection gate (30–89 day / "late" invoice window).
 *
 * The gate lives in proposeInvoiceChanges inside priceTracking.ts and prevents a
 * moderately-stale invoice from silently overwriting a more-recent, correct price.
 * Two pure functions are exported for testability:
 *
 *   shouldGateStaleInvoice(invoiceDateStr, costPriceBasisDate, changePercent, costPriceSource)
 *     → boolean: the decision function
 *
 *   buildStaleFlagDoc(opts)
 *     → StaleFlagDoc: the priceChangeFlags payload, schema-parity with Case 1
 *
 * Strategy: pure functions only — no Firestore, no network, same pattern as
 * gpAlerts.test.ts and impactOnGP.test.ts.
 *
 * Coverage:
 *   A. Gate decision — shouldGateStaleInvoice
 *   B. Flag document shape — buildStaleFlagDoc, schema parity with Case 1
 *   C. End-to-end scenarios — regression + first-invoice + stale+large+manual
 */

import { shouldGateStaleInvoice, buildStaleFlagDoc } from "../priceTracking";

// ── Fixtures ─────────────────────────────────────────────────────────────────

// costPriceBasisDate: the product's recorded basis timestamp, as a JS Date.
// Represents "price was last confirmed on 2026-08-01".
const BASIS_DATE = new Date("2026-08-01T00:00:00.000Z");

// A fresh invoice — dated AFTER the basis (newer), should never be gated.
const FRESH_INVOICE_DATE = "2026-08-15";

// A stale invoice — dated BEFORE the basis (older than the recorded price).
const STALE_INVOICE_DATE = "2026-07-01";

// ── Suite A: shouldGateStaleInvoice — gate decision ──────────────────────────

describe("shouldGateStaleInvoice — gate decision logic", () => {

  // ── A1: regression — fresh invoice, never gated ───────────────────────────

  it("fresh invoice (newer than costPriceBasisDate) with large change: NOT gated", () => {
    // Regression check — this must be completely unaffected by the gate.
    // A current/recent invoice with a 20% price jump should still flow through as a normal proposal.
    expect(
      shouldGateStaleInvoice(FRESH_INVOICE_DATE, BASIS_DATE, 20, "invoice")
    ).toBe(false);
  });

  it("fresh invoice (newer) with manual source: NOT gated", () => {
    expect(
      shouldGateStaleInvoice(FRESH_INVOICE_DATE, BASIS_DATE, 8, "manual")
    ).toBe(false);
  });

  it("invoice dated exactly at costPriceBasisDate (same day): NOT gated", () => {
    // Boundary: same-day invoice is not older, so no conflict — allow through.
    const sameDay = new Date("2026-08-01T00:00:00.000Z");
    const sameDayStr = "2026-08-01";
    // invoiceDateObj (midnight) < basisDate (also midnight) is false when equal
    // — strictly-less-than, so same-day is NOT stale.
    expect(
      shouldGateStaleInvoice(sameDayStr, sameDay, 20, "invoice")
    ).toBe(false);
  });

  // ── A2: no prior basis — first invoice ever, never gated ─────────────────

  it("no costPriceBasisDate (first invoice ever): NOT gated regardless of size", () => {
    // Product has never had a price set. The invoice should always succeed.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, null, 50, "manual")
    ).toBe(false);
  });

  it("no costPriceBasisDate + small change: NOT gated", () => {
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, null, 2, "invoice")
    ).toBe(false);
  });

  // ── A3: null / missing / bad invoice date — never gated ──────────────────

  it("null invoiceDate: NOT gated", () => {
    expect(
      shouldGateStaleInvoice(null, BASIS_DATE, 20, "invoice")
    ).toBe(false);
  });

  it("undefined invoiceDate: NOT gated", () => {
    expect(
      shouldGateStaleInvoice(undefined, BASIS_DATE, 20, "invoice")
    ).toBe(false);
  });

  it("empty string invoiceDate: NOT gated", () => {
    expect(
      shouldGateStaleInvoice("", BASIS_DATE, 20, "invoice")
    ).toBe(false);
  });

  it("unparseable invoiceDate string: NOT gated (never crash)", () => {
    expect(
      shouldGateStaleInvoice("not-a-date", BASIS_DATE, 20, "invoice")
    ).toBe(false);
  });

  // ── A4: stale + large change ──────────────────────────────────────────────

  it("stale invoice + large change (>=5%) + invoice-derived price: GATED", () => {
    // Invoice is older than basis AND change is significant — must be held.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 20, "invoice")
    ).toBe(true);
  });

  it("stale invoice + large change (>=5%) + manually-set price: GATED", () => {
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 20, "manual")
    ).toBe(true);
  });

  it("stale invoice + exactly 5% change + invoice-derived: GATED (at threshold)", () => {
    // 5% is the significance bar — should gate at exactly 5%.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 5, "invoice")
    ).toBe(true);
  });

  it("stale invoice + exactly -5% change (decrease) + invoice-derived: GATED", () => {
    // Gate uses |changePercent| — decreases are equally significant.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, -5, "invoice")
    ).toBe(true);
  });

  // ── A5: stale + small change — materiality matters ────────────────────────

  it("stale invoice + small change (<5%) + invoice-derived price: NOT gated (auto-blend)", () => {
    // The spec explicitly requires this: staleness alone is not enough.
    // A minor drift correction on an invoice-derived price should still blend automatically.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 3, "invoice")
    ).toBe(false);
  });

  it("stale invoice + 4.99% change + invoice-derived: NOT gated (just below threshold)", () => {
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 4.99, "invoice")
    ).toBe(false);
  });

  it("stale invoice + zero change: NOT gated (this wouldn't even reach the gate in practice)", () => {
    // proposeInvoiceChanges only enters pctDiff>0.01 when there IS a meaningful change;
    // this confirms the gate itself doesn't break on edge inputs.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 0, "invoice")
    ).toBe(false);
  });

  // ── A6: stale + small change + manual price — manual always triggers ──────

  it("stale invoice + small change (<5%) + manually-set price: GATED", () => {
    // Manual prices carry more provenance weight than invoice-derived ones.
    // Even a tiny stale change against a manual price should be reviewed.
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 2, "manual")
    ).toBe(true);
  });

  it("stale invoice + 1% change + manual price: GATED", () => {
    expect(
      shouldGateStaleInvoice(STALE_INVOICE_DATE, BASIS_DATE, 1, "manual")
    ).toBe(true);
  });
});

// ── Suite B: buildStaleFlagDoc — schema parity with Case 1 ───────────────────
//
// Case 1 in processHistoricalInvoiceLines (historical_invoice_conflict) is the
// established schema for "price conflict queued for manager review". The stale-
// invoice gate must produce a document with identical field names and types,
// with only flagReason differing. This is verified by reading the exact field set
// and checking every value. (flaggedAt is omitted from the builder — the caller
// appends serverTimestamp() at write time, matching Case 1's own pattern.)

describe("buildStaleFlagDoc — schema parity with Case 1 (historical_invoice_conflict)", () => {

  const BASE_OPTS = {
    productId: "gin-700ml-1",
    productName: "Gin 700ml",
    supplierId: "sup-allied-1",
    supplierName: "Allied Beverages",
    invoiceId: "inv-stale-123",
    invoiceDocId: "docid-stale-456",
    oldPrice: 40.00,
    newPrice: 48.00,
    changePercent: 20,
    direction: "increase" as const,
    currentPriceSetAt: null,        // Timestamp | null — opaque, just passed through
    currentPriceSource: "manual",
    proposedHistoricalInvoiceDate: "2026-07-01",
    qty: 1,
    caseSize: null,
  };

  it("flagReason is 'stale_invoice_conflict' (not historical_invoice_conflict)", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.flagReason).toBe("stale_invoice_conflict");
  });

  it("status is 'pending' — matches Case 1", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.status).toBe("pending");
  });

  it("acknowledgedBy and acknowledgedAt are null — matches Case 1", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.acknowledgedBy).toBeNull();
    expect(doc.acknowledgedAt).toBeNull();
  });

  it("impactOnGP is null — matches Case 1", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.impactOnGP).toBeNull();
  });

  it("note is null — matches Case 1", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.note).toBeNull();
  });

  it("oldPrice = current protected price; newPrice = what the stale invoice shows", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.oldPrice).toBe(40.00);
    expect(doc.newPrice).toBe(48.00);
  });

  it("changePercent and direction are correctly threaded through", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.changePercent).toBe(20);
    expect(doc.direction).toBe("increase");
  });

  it("currentPriceSource is preserved from the product (distinguishes manual from invoice)", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.currentPriceSource).toBe("manual");
  });

  it("proposedHistoricalInvoiceDate carries the stale invoice's date — matches Case 1 field name", () => {
    const doc = buildStaleFlagDoc(BASE_OPTS);
    expect(doc.proposedHistoricalInvoiceDate).toBe("2026-07-01");
  });

  it("supplierId and supplierName are passed through (may be null)", () => {
    const doc = buildStaleFlagDoc({ ...BASE_OPTS, supplierId: null, supplierName: null });
    expect(doc.supplierId).toBeNull();
    expect(doc.supplierName).toBeNull();
  });

  it("invoiceDocId is passed through (may be null when not from OCR flow)", () => {
    const doc = buildStaleFlagDoc({ ...BASE_OPTS, invoiceDocId: null });
    expect(doc.invoiceDocId).toBeNull();
  });

  it("complete field set matches Case 1 exactly — no extra or missing keys", () => {
    // The exact fields that Case 1 (historical_invoice_conflict) writes, minus flaggedAt.
    // This is the authoritative list — any deviation from it breaks the manager review screen.
    const doc = buildStaleFlagDoc(BASE_OPTS);
    const expectedKeys = new Set([
      "productId", "productName", "supplierId", "supplierName",
      "invoiceId", "invoiceDocId",
      "oldPrice", "newPrice", "changePercent", "direction",
      "currentPriceSetAt", "currentPriceSource",
      "proposedHistoricalInvoiceDate",
      "qty", "caseSize",
      "flagReason", "status",
      "acknowledgedBy", "acknowledgedAt",
      "impactOnGP", "note",
    ]);
    expect(new Set(Object.keys(doc))).toEqual(expectedKeys);
  });
});

// ── Suite C: end-to-end scenarios — spec requirements ────────────────────────

describe("stale-invoice gate — spec-required end-to-end scenarios", () => {

  it("C1 (regression): fresh, non-stale invoice with normal change blends automatically", () => {
    // The gate MUST NOT change behaviour for current invoices. A standard price
    // change from a fresh invoice should pass through unchanged.
    const isGated = shouldGateStaleInvoice(
      "2026-09-01",         // fresh — after the 2026-08-01 basis
      new Date("2026-08-01T00:00:00.000Z"),
      12,                   // normal-sized change
      "invoice",
    );
    expect(isGated).toBe(false);
  });

  it("C2: product with no costPriceBasisAt (first invoice ever) always blends normally", () => {
    // No prior basis means no prior price to protect — always allow.
    const isGated = shouldGateStaleInvoice(
      "2026-06-01",         // old date, but no basis to compare against
      null,                 // no costPriceBasisAt — truly first invoice
      50,                   // large change wouldn't matter
      "manual",             // manual source wouldn't matter
    );
    expect(isGated).toBe(false);
  });

  it("C3: stale invoice + large change + manually-set price → held for review", () => {
    // The primary spec requirement: a stale invoice with a significant change
    // against a manually-set price must be blocked and queued for manager review.
    const isGated = shouldGateStaleInvoice(
      "2026-07-01",         // stale — before the 2026-08-01 basis
      new Date("2026-08-01T00:00:00.000Z"),
      20,                   // large: 20% > 5% threshold
      "manual",             // manually-set price carries more weight
    );
    expect(isGated).toBe(true);

    // And the resulting flag document is shaped correctly
    const doc = buildStaleFlagDoc({
      productId: "gin-1",
      productName: "Gin 700ml",
      supplierId: "sup-1",
      supplierName: "Allied Beverages",
      invoiceId: "inv-stale",
      invoiceDocId: null,
      oldPrice: 40.00,
      newPrice: 48.00,
      changePercent: 20,
      direction: "increase",
      currentPriceSetAt: null,
      currentPriceSource: "manual",
      proposedHistoricalInvoiceDate: "2026-07-01",
      qty: 1,
      caseSize: null,
    });
    expect(doc.status).toBe("pending");
    expect(doc.flagReason).toBe("stale_invoice_conflict");
    expect(doc.acknowledgedBy).toBeNull();
    expect(doc.currentPriceSource).toBe("manual");
  });

  it("C4: stale invoice + only small change + invoice-derived price → still blends automatically", () => {
    // Staleness alone is not sufficient. A small drift in an invoice-derived price
    // should still blend automatically, per the spec.
    const isGated = shouldGateStaleInvoice(
      "2026-07-01",         // stale
      new Date("2026-08-01T00:00:00.000Z"),
      2,                    // small: 2% < 5% threshold
      "invoice",            // invoice-derived — lower provenance weight
    );
    expect(isGated).toBe(false);
  });
});
