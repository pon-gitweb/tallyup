/**
 * Safe, non-throwing reconciliation persistence for parsed invoices (CSV/PDF).
 * - Never assumes fields exist; normalizes to a stable envelope.
 * - Writes under: venues/{venueId}/orders/{orderId}/reconciliations/{autoId}
 * - Returns { ok:true, id } or { ok:false, error }
 */
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp
} from 'firebase/firestore';

export type ParsedLine = {
  code?: string;
  name: string;
  qty: number;
  unitPrice?: number;
};

export type ParsedInvoicePayload = {
  invoice?: { source?: 'csv'|'pdf'|string; storagePath?: string; poNumber?: string|null } | null;
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

/** Normalize any CSV/PDF server response into a stable envelope */
export function buildReconEnvelope(args: {
  venueId: string;
  orderId: string;
  source: 'csv'|'pdf';
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
    source: (p?.invoice?.source ?? args.source) as 'csv'|'pdf'|string,
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
    diffs: {},              // placeholder (server/client diffing added later)
    meta: {
      orderPo,
      parsedPo,
      poMismatch,
    },
    createdAt: null as any, // will be serverTimestamp on write
  };

  return envelope;
}

/**
 * Persist the normalized envelope; never throws.
 * Returns { ok:true, id } or { ok:false, error }
 */
export async function persistAfterParse(args: {
  venueId: string;
  orderId: string;
  source: 'csv'|'pdf';
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
