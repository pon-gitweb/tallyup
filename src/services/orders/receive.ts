// @ts-nocheck
/**
 * Order receive finalization.
 * - Fetch order lines
 * - Reconcile parsed invoice lines vs order lines
 * - Save reconciliation bundle
 * - Mark order received (idempotent)
 *
 * NOTE: We intentionally DO NOT mutate the submitted order lines or prices.
 * Any price updates are handled via review workflows later.
 */

import { getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
} from 'firebase/firestore';

import {
  reconcileInvoiceWithOrder,
  type ParsedInvoiceLine,
  type ReconciliationResult,
} from '../invoices/reconciliation';

import { saveReconciliation } from '../invoices/reconciliationStore';

type FinalizeArgs = {
  venueId: string;
  orderId: string;
  parsed: {
    invoice: { source: 'csv' | 'pdf'; storagePath: string; poNumber?: string | null };
    lines: ParsedInvoiceLine[];
    matchReport?: { warnings?: string[] } | null;
    confidence?: number;
    warnings?: string[];
  };
  options?: {
    qtyTolerance?: number;      // default 0
    priceTolerance?: number;    // default 0
  };
};

async function fetchOrderLines(db: ReturnType<typeof getFirestore>, venueId: string, orderId: string) {
  const linesRef = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
  const snap = await getDocs(linesRef);
  const out: Array<{ id: string; productId?: string; name?: string; qty?: number; unitCost?: number }> = [];
  snap.forEach((d) => {
    const v: any = d.data() || {};
    out.push({
      id: d.id,
      productId: v.productId,
      name: v.name,
      qty: Number.isFinite(v.qty) ? Number(v.qty) : (v.qty || 0),
      unitCost: Number.isFinite(v.unitCost) ? Number(v.unitCost) : (v.unitCost || 0),
    });
  });
  return out;
}

async function markOrderReceived(db: ReturnType<typeof getFirestore>, venueId: string, orderId: string) {
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Order not found');

  const cur: any = snap.data() || {};
  // Idempotent: if already received, don't regress fields
  const patch: any = {
    status: 'received',
    displayStatus: 'received',
    updatedAt: serverTimestamp(),
  };
  if (!cur.receivedAt) patch.receivedAt = serverTimestamp();

  await updateDoc(ref, patch);
}

async function finalizeReceiveCommon(args: FinalizeArgs): Promise<{
  reconciliationId: string;
  reconciliation: ReconciliationResult;
}> {
  const { venueId, orderId, parsed, options } = args;
  if (!venueId || !orderId) throw new Error('venueId/orderId required');
  if (!parsed || !parsed.invoice || !parsed.lines) throw new Error('parsed invoice payload required');

  const db = getFirestore(getApp());

  // 1) Load canonical order lines
  const orderLines = await fetchOrderLines(db, venueId, orderId);

  // 2) Run reconciliation
  const rec = reconcileInvoiceWithOrder(
    parsed.lines,
    orderLines,
    {
      source: parsed.invoice.source,
      storagePath: parsed.invoice.storagePath,
      poNumber: parsed.invoice.poNumber ?? null,
      confidence: parsed.confidence ?? null,
      warnings: [
        ...(parsed.warnings || []),
        ...((parsed.matchReport && parsed.matchReport.warnings) || []),
      ],
    },
    {
      qtyTolerance: options?.qtyTolerance ?? 0,
      priceTolerance: options?.priceTolerance ?? 0,
    }
  );

  // 3) Persist the reconciliation bundle
  const saved = await saveReconciliation(venueId, orderId, rec);

  // 4) Mark the order as received (does not alter original lines)
  await markOrderReceived(db, venueId, orderId);

  return { reconciliationId: saved.id, reconciliation: rec };
}

/**
 * CSV path: used by OrderDetailScreen when user confirms a CSV invoice.
 * Signature kept to match existing imports.
 */
export async function finalizeReceiveFromCsv(args: FinalizeArgs) {
  return finalizeReceiveCommon(args);
}

/**
 * PDF path: same behaviour as CSV once you wire the Confirm action.
 * (Your UI currently shows a "Confirm (stub)" — call this when you hook it up.)
 */
export async function finalizeReceiveFromPdf(args: FinalizeArgs) {
  return finalizeReceiveCommon(args);
}
