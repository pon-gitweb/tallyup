// Firestore persistence for invoice reconciliation results.
// One job: take the server /api/reconcile-invoice response + minimal invoice meta
// and store it under venues/{venueId}/orders/{orderId}/reconciliations/{reconciliationId}

import { getFirestore, collection, doc, setDoc, serverTimestamp } from "firebase/firestore";

export type InvoiceMeta = {
  source: "csv" | "pdf";
  storagePath: string;
  poNumber?: string | null;
};

export type ReconciliationCounts = {
  matched: number;
  unknown: number;
  priceChanges: number;
  qtyDiffs: number;
  missingOnInvoice: number;
};

export type ReconciliationTotals = {
  ordered: number;   // total $ ordered (from submitted order snapshot)
  invoiced: number;  // total $ on invoice
  delta: number;     // invoiced - ordered
};

export type ReconciliationSummary = {
  poMatch: boolean;
  counts: ReconciliationCounts;
  totals: ReconciliationTotals;
};

export type ReconciliationResult = {
  reconciliationId?: string;           // from server; optional
  summary: ReconciliationSummary;      // required
  confidence?: number | null;          // 0..1; server- or client-enforced
  warnings?: string[];                 // optional notes/anomalies
  invoice: InvoiceMeta;                // minimal invoice meta
};

// Stored document shape
export type ReconciliationDoc = {
  reconciliationId: string;            // id used in subcollection
  venueId: string;
  orderId: string;

  invoiceMeta: InvoiceMeta;
  summary: ReconciliationSummary;
  confidence: number | null;
  warnings: string[];

  createdAt: any;  // serverTimestamp
  updatedAt: any;  // serverTimestamp
};

/**
 * Persist a reconciliation result under:
 *   venues/{venueId}/orders/{orderId}/reconciliations/{reconciliationId}
 *
 * Returns the reconciliationId actually written.
 */
export async function persistReconciliationResult(params: {
  venueId: string;
  orderId: string;
  result: ReconciliationResult;
}): Promise<string> {
  const { venueId, orderId, result } = params;

  // Basic validation to avoid "Cannot convert undefined value to object" style errors
  if (!venueId || !orderId) throw new Error("persistReconciliationResult: missing venueId/orderId");
  if (!result || !result.summary || !result.invoice) {
    throw new Error("persistReconciliationResult: invalid result payload (summary/invoice required)");
  }

  const db = getFirestore();
  const colRef = collection(db, "venues", venueId, "orders", orderId, "reconciliations");

  // Use server-provided ID if present; otherwise create a fresh one
  const recId = (result.reconciliationId && String(result.reconciliationId)) || doc(colRef).id;
  const docRef = doc(colRef, recId);

  const poMatch = !!result.summary?.poMatch;
  // If server didn’t supply confidence, enforce a safe rule locally
  const confidence =
    typeof result.confidence === "number" ? result.confidence : (poMatch ? 0.5 : 0);

  const payload: ReconciliationDoc = {
    reconciliationId: recId,
    venueId,
    orderId,
    invoiceMeta: {
      source: result.invoice.source,
      storagePath: result.invoice.storagePath,
      poNumber: result.invoice.poNumber ?? null,
    },
    summary: result.summary,
    confidence,
    warnings: result.warnings ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(docRef, payload, { merge: true });
  return recId;
}

/**
 * Narrow helper that matches the client "after-parse" usage:
 * Accepts minimal fields and wraps them into ReconciliationResult.
 */
export async function persistAfterParse(opts: {
  venueId: string;
  orderId: string;
  reconciliationId?: string;
  invoice: InvoiceMeta;
  summary: ReconciliationSummary;
  confidence?: number | null;
  warnings?: string[];
}): Promise<string> {
  return persistReconciliationResult({
    venueId: opts.venueId,
    orderId: opts.orderId,
    result: {
      reconciliationId: opts.reconciliationId,
      invoice: opts.invoice,
      summary: opts.summary,
      confidence: typeof opts.confidence === "number" ? opts.confidence : null,
      warnings: opts.warnings ?? [],
    },
  });
}
