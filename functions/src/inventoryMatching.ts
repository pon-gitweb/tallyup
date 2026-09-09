/**
 * Shared product-name matching and new-product detection for inventory import.
 *
 * Used by both:
 *  - ocrInvoicePhoto.ts (processUnpricedLines) — invoice photo scan path
 *  - api.ts (/extract-inventory) — PDF/CSV/file upload path
 *
 * Mirrors supplierResolution.ts's design: one authoritative implementation,
 * imported from both callers, so they cannot drift independently.
 */
import * as admin from "firebase-admin";
import { overlapCoefficient } from "./nameMatching";

// ── Name normalisation ────────────────────────────────────────────────────────

/**
 * Normalise a product name for fuzzy comparison.
 * Lowercases, strips non-alphanumeric-except-space, collapses whitespace.
 * Intentionally simple — product names need no legal-suffix stripping.
 */
export function normProductName(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

// ── Matching predicate ────────────────────────────────────────────────────────

/**
 * Returns true when two product names refer to the same product.
 *
 * Decision rules (both must be non-empty):
 *   1. Exact normalized match — fastest path, handles SKU-style names.
 *   2. Overlap coefficient ≥ 0.85 — handles abbreviations and minor
 *      differences in wording ("Heineken 330ml" ↔ "Heineken 330 ml Bottles").
 *
 * Threshold of 0.85 is deliberately tight: false positives (merging two
 * distinct products) are far more harmful than false negatives (surfacing
 * a product that already exists as a new-product proposal).
 */
export function productNamesMatch(a: string, b: string): boolean {
  const na = normProductName(a);
  const nb = normProductName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return overlapCoefficient(a, b) >= 0.85;
}

// ── Proposal type (matches the shape expected by commitInvoiceChanges) ────────

export type NewProductProposal = {
  id: string;
  type: "newProduct";
  lineName: string;
  unitPrice: number | null;
  qty: number | null;
  caseSize: number | null;
  supplierId: string | null;
  supplierName: string | null;
};

// ── Core detection function ───────────────────────────────────────────────────

/**
 * Given a list of product names from an import source, loads the venue's
 * product catalog and returns a newProduct proposal for each name that does
 * not match an existing product.
 *
 * De-duplicates by normalized name so the same product appearing twice
 * (e.g. across multiple CSV rows) produces only one proposal.
 *
 * Does NOT auto-create products — proposals are surfaced for user review
 * and committed via commitInvoiceDecisions, exactly as the invoice scan path.
 */
export async function detectNewProducts(args: {
  db: admin.firestore.Firestore;
  venueId: string;
  productNames: string[];
  sourceId: string;
  supplierId?: string | null;
  supplierName?: string | null;
}): Promise<{ proposals: NewProductProposal[] }> {
  const {
    db, venueId, productNames, sourceId,
    supplierId = null, supplierName = null,
  } = args;

  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const existingProds = productsSnap.docs.map(d => ({
    id: d.id,
    name: (d.data() as any).name || "",
  }));

  const proposals: NewProductProposal[] = [];
  const seen = new Set<string>();

  for (const name of productNames) {
    if (!name?.trim()) continue;
    const key = normProductName(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const matched = existingProds.some(ep => productNamesMatch(name, ep.name));
    if (matched) continue;

    proposals.push({
      id: `${sourceId}:newProduct:${key.replace(/\s+/g, "")}`,
      type: "newProduct",
      lineName: name.trim(),
      unitPrice: null,
      qty: null,
      caseSize: null,
      supplierId,
      supplierName,
    });
  }

  return { proposals };
}
