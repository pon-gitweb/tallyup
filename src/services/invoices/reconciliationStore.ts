// @ts-nocheck
/**
 * Persists reconciliation bundles to Firestore under:
 *   venues/{venueId}/orders/{orderId}/reconciliations/{autoId}
 *
 * - Expo-safe (no firebase-admin)
 * - Stores a compact "diff card" plus the full bundle for drill-down
 */

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type {
  ReconciliationResult,
  ReconciliationMatch,
} from './reconciliation';

function firstN<T>(arr: T[], n = 20): T[] {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

function buildDiffCard(result: ReconciliationResult) {
  const { summary, totals, anomalies } = result;

  // Pull out a few illustrative differences
  const qtyChanged = result.matches.filter(m => m.flags.qtyChanged && m.order && m.invoice);
  const priceChanged = result.matches.filter(m => m.flags.priceChanged && m.order && m.invoice);
  const newItems = result.matches.filter(m => m.flags.newItem);
  const missingItems = result.matches.filter(m => m.flags.missingItem);

  // Keep cards tiny; full detail is saved in "bundle"
  const pickMini = (m: ReconciliationMatch) => ({
    key: m.key,
    via: m.via,
    order: m.order ? {
      id: m.order.id,
      name: m.order.name,
      qty: m.order.qty,
      unitCost: m.order.unitCost,
      ext: m.order.ext,
    } : null,
    invoice: m.invoice ? {
      code: m.invoice.code,
      name: m.invoice.name,
      qty: m.invoice.qty,
      unitPrice: m.invoice.unitPrice,
      ext: m.invoice.ext,
    } : null,
    deltas: m.deltas,
  });

  return {
    headline: {
      orderValue: totals.orderValue,
      invoiceValue: totals.invoiceValue,
      valueDelta: totals.valueDelta,
    },
    counts: {
      matched: totals.linesMatched,
      invoiceOnly: totals.linesInvoiceOnly,
      orderOnly: totals.linesOrderOnly,
      qtyChanged: summary.qtyChanged,
      priceChanged: summary.priceChanged,
      newItems: summary.newItems,
      missingItems: summary.missingItems,
    },
    samples: {
      qtyChanged: firstN(qtyChanged, 10).map(pickMini),
      priceChanged: firstN(priceChanged, 10).map(pickMini),
      newItems: firstN(newItems, 10).map(pickMini),
      missingItems: firstN(missingItems, 10).map(pickMini),
    },
    anomalies: firstN(anomalies, 20),
  };
}

/**
 * Save reconciliation bundle and a compact "diff card".
 * Returns the created doc ref id.
 */
export async function saveReconciliationBundle(
  venueId: string,
  orderId: string,
  result: ReconciliationResult
): Promise<{ id: string }> {
  if (!venueId || !orderId) throw new Error('venueId/orderId required');

  const db = getFirestore();
  const col = collection(db, 'venues', venueId, 'orders', orderId, 'reconciliations');

  const docBody = {
    createdAt: serverTimestamp(),
    // meta from the reconciler
    meta: {
      source: result.meta.source,               // 'csv' | 'pdf'
      storagePath: result.meta.storagePath,     // gs path we parsed
      poNumber: result.meta.poNumber ?? null,
      confidence: result.meta.confidence ?? null,
      warnings: result.meta.warnings ?? [],
      landed: result.meta.landed ?? null,       // optional
    },
    totals: result.totals,
    summary: result.summary,
    // compact “card” for quick viewing / reporting
    diffCard: buildDiffCard(result),
    // keep the full bundle for drill-down (may be large)
    bundle: {
      matches: result.matches,
      anomalies: result.anomalies,
    },
  };

  const ref = await addDoc(col, docBody);
  return { id: ref.id };
}
