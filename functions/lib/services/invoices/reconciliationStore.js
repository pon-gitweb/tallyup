"use strict";
// Firestore persistence for invoice reconciliation results.
// One job: take the server /api/reconcile-invoice response + minimal invoice meta
// and store it under venues/{venueId}/orders/{orderId}/reconciliations/{reconciliationId}
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistReconciliationResult = persistReconciliationResult;
exports.persistAfterParse = persistAfterParse;
const firestore_1 = require("firebase/firestore");
/**
 * Persist a reconciliation result under:
 *   venues/{venueId}/orders/{orderId}/reconciliations/{reconciliationId}
 *
 * Returns the reconciliationId actually written.
 */
async function persistReconciliationResult(params) {
    const { venueId, orderId, result } = params;
    // Basic validation to avoid "Cannot convert undefined value to object" style errors
    if (!venueId || !orderId)
        throw new Error("persistReconciliationResult: missing venueId/orderId");
    if (!result || !result.summary || !result.invoice) {
        throw new Error("persistReconciliationResult: invalid result payload (summary/invoice required)");
    }
    const db = (0, firestore_1.getFirestore)();
    const colRef = (0, firestore_1.collection)(db, "venues", venueId, "orders", orderId, "reconciliations");
    // Use server-provided ID if present; otherwise create a fresh one
    const recId = (result.reconciliationId && String(result.reconciliationId)) || (0, firestore_1.doc)(colRef).id;
    const docRef = (0, firestore_1.doc)(colRef, recId);
    const poMatch = !!result.summary?.poMatch;
    // If server didn’t supply confidence, enforce a safe rule locally
    const confidence = typeof result.confidence === "number" ? result.confidence : (poMatch ? 0.5 : 0);
    const payload = {
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
        createdAt: (0, firestore_1.serverTimestamp)(),
        updatedAt: (0, firestore_1.serverTimestamp)(),
    };
    await (0, firestore_1.setDoc)(docRef, payload, { merge: true });
    return recId;
}
/**
 * Narrow helper that matches the client "after-parse" usage:
 * Accepts minimal fields and wraps them into ReconciliationResult.
 */
async function persistAfterParse(opts) {
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
//# sourceMappingURL=reconciliationStore.js.map