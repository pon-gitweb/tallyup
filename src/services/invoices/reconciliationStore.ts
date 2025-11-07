/**
 * Safe, non-throwing reconciliation persistence for parsed invoices (CSV/PDF/Manual).
 * - Normalization for parse payloads (per-order snapshot): venues/{v}/orders/{o}/reconciliations/{autoId}
 * - Summary for finalized reconciliations (venue-level list): venues/{v}/reconciliations/{autoId}
 * - All functions return { ok:true, id } or { ok:false, error }
 */
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp,
} from 'firebase/firestore';

export type ParsedLine = {
  code?: string;
  name: string;
  qty: number;
  unitPrice?: number;
};

export type ParsedInvoicePayload = {
  invoice?: { source?: 'csv'|'pdf'|'manual'|string; storagePath?: string; poNumber?: string|null } | null;
  lines?: ParsedLine[] | null;
  matchReport?: { warnings?: string[] } | null;
  confidence?: number | null;
  warnings?: string[] | null;
};

/** Compute a conservative confidence when missing/bad */
function safeConfidence(input?: number | null, fallback = 0.4) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

/** Normalize any CSV/PDF/MANUAL server response into a stable envelope (per-order snapshot) */
export function buildReconEnvelope(args: {
  venueId: string;
  orderId: string;
  source: 'csv'|'pdf'|'manual';
  storagePath: string;
  payload: ParsedInvoicePayload | any;
  orderPo?: string | null;
  parsedPo?: string | null;
}) {
  const p = (args?.payload ?? {}) as ParsedInvoicePayload;

  const lines = Array.isArray(p.lines)
    ? p.lines.filter(Boolean).map((l:any) => ({
        code: (l?.code ?? undefined) as string | undefined,
        name: String(l?.name ?? l?.code ?? '(item)'),
        qty: Number.isFinite(Number(l?.qty)) ? Number(l?.qty) : 0,
        unitPrice: Number.isFinite(Number(l?.unitPrice)) ? Number(l?.unitPrice) : undefined,
      }))
    : [];

  const warnings = [
    ...(Array.isArray(p.warnings) ? p.warnings.filter(Boolean) : []),
    ...(Array.isArray(p?.matchReport?.warnings) ? p.matchReport!.warnings!.filter(Boolean) : []),
  ];

  const invoice = {
    source: (p?.invoice?.source ?? args.source) as 'csv'|'pdf'|'manual'|string,
    storagePath: String(p?.invoice?.storagePath ?? args.storagePath ?? ''),
    poNumber: (p?.invoice?.poNumber ?? null) as string | null,
  };

  const orderPo = (args.orderPo ?? '').trim() || null;
  const parsedPo = (args.parsedPo ?? '').trim() || (invoice.poNumber ?? null);
  const poMismatch = !!(orderPo && parsedPo && orderPo !== parsedPo);

  const envelope = {
    ok: true,
    kind: 'invoice_parse' as const,
    venueId: String(args.venueId),
    orderId: String(args.orderId),
    invoice,
    lines,
    matchReport: (p?.matchReport && typeof p.matchReport === 'object') ? p.matchReport : null,
    confidence: safeConfidence(p?.confidence, 0.4),
    warnings,
    diffs: {},              // placeholder (server/client diffing later)
    meta: {
      orderPo,
      parsedPo,
      poMismatch,
    },
    createdAt: null as any, // serverTimestamp on write
  };

  return envelope;
}

/**
 * Persist the normalized envelope under the ORDER (historical parse snapshot); never throws.
 * Path: venues/{venueId}/orders/{orderId}/reconciliations/{autoId}
 */
export async function persistAfterParse(args: {
  venueId: string;
  orderId: string;
  source: 'csv'|'pdf'|'manual';
  storagePath: string;
  payload: ParsedInvoicePayload | any;
  orderPo?: string | null;
  parsedPo?: string | null;
}) {
  try {
    const db = getFirestore(getApp());
    const col = collection(db, 'venues', args.venueId, 'orders', args.orderId, 'reconciliations');

    const env = buildReconEnvelope(args);
    const toWrite = { ...env, createdAt: serverTimestamp() };

    const docRef = await addDoc(col, toWrite);
    return { ok: true, id: docRef.id };
  } catch (e:any) {
    if (__DEV__) console.log('[persistAfterParse] error', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Save a finalized reconciliation SUMMARY at the VENUE level (powers dashboards/panels).
 * Path: venues/{venueId}/reconciliations/{autoId}
 * Accepts the server response from reconcile-invoice (see services/invoices/reconcile.ts).
 */
export async function saveReconciliation(
  venueId: string,
  orderId: string,
  reconciled: {
    ok: boolean;
    reconciliationId?: string | null;
    summary?: {
      poMatch?: boolean;
      counts?: { matched?: number; unknown?: number; priceChanges?: number; qtyDiffs?: number; missingOnInvoice?: number; };
      totals?: { ordered?: number; invoiced?: number; delta?: number; };
      supplierName?: string | null;
    };
    error?: string;
  }
) {
  try {
    if (!reconciled?.ok) {
      return { ok: false, error: reconciled?.error || 'reconcile not ok' };
    }
    const db = getFirestore(getApp());

    // Flatten counts into a compact anomalies list for UI
    const c = reconciled?.summary?.counts || {};
    const anomalies: Array<{ type: string; count: number }> = [];
    for (const [k, v] of Object.entries(c)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) anomalies.push({ type: k, count: n });
    }

    const docRef = await addDoc(collection(db, 'venues', venueId, 'reconciliations'), {
      orderId,
      reconciliationId: reconciled?.reconciliationId ?? null,
      supplierName: reconciled?.summary?.supplierName ?? null,
      totals: {
        orderTotal: Number(reconciled?.summary?.totals?.ordered ?? NaN),
        invoiceTotal: Number(reconciled?.summary?.totals?.invoiced ?? NaN),
        delta: Number(reconciled?.summary?.totals?.delta ?? NaN),
      },
      counts: reconciled?.summary?.counts || null,
      anomalies,
      poMatch: !!reconciled?.summary?.poMatch,
      createdAt: serverTimestamp(),
      kind: 'invoice_reconcile',
    });

    return { ok: true, id: docRef.id };
  } catch (e:any) {
    if (__DEV__) console.log('[saveReconciliation] error', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}
