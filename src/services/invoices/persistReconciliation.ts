// @ts-nocheck
/**
 * Lightweight persistence for parsed invoice results (CSV/PDF).
 * - Guards against undefined/null payloads (no crash, just logs).
 * - Writes a small event document so we can surface "Diffs cards" later.
 * - NO assumptions about diffs schema; we store what we safely have.
 *
 * If Firestore write is blocked by rules, we fail soft (console.warn) and return ok:false.
 */

import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

export type ParsedInvoiceMinimal = {
  invoice?: { source?: 'csv'|'pdf'|string; storagePath?: string; poNumber?: string|null } | null;
  lines?: Array<{ code?: string; name?: string; qty?: number; unitPrice?: number }> | null;
  matchReport?: { warnings?: string[] } | null;
  confidence?: number | null;
  warnings?: string[] | null;
  // Future: diffs?: Record<string, any> | null;
};

export type PersistArgs = {
  venueId: string;
  orderId: string;
  result?: ParsedInvoiceMinimal | null;
  meta?: Record<string, any> | null; // optional caller metadata
};

function asArray<T=any>(v: any): T[] { return Array.isArray(v) ? v : []; }
function asString(v: any): string { return (v == null ? '' : String(v)); }
function clamp01(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

export async function persistAfterParse(args: PersistArgs): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const { venueId, orderId, result, meta } = args || {};
    if (!venueId || !orderId) {
      console.warn('[persistAfterParse] missing venueId/orderId');
      return { ok:false, reason:'missing_ids' };
    }
    if (!result) {
      console.warn('[persistAfterParse] no result payload; skipping write');
      return { ok:false, reason:'empty_result' };
    }

    // Normalise minimal, safe fields — nothing throws if fields are absent.
    const inv = result.invoice || {};
    const lines = asArray(result.lines);
    const warns = asArray(result.warnings || (result.matchReport?.warnings ?? []));
    const confidence = clamp01(result.confidence);

    // Tiny roll-up stats we may show in Reports later.
    const stats = {
      linesCount: lines.length,
      nonZeroUnitPrices: lines.filter(x => Number(x?.unitPrice) > 0).length,
      nonZeroQty: lines.filter(x => Number(x?.qty) > 0).length,
      confidence,
    };

    const payload = {
      createdAt: serverTimestamp(),
      venueId,
      orderId,
      invoice: {
        source: asString(inv.source),
        storagePath: asString(inv.storagePath),
        poNumber: inv.poNumber ?? null,
      },
      warnings: warns,
      matchReport: result.matchReport || null,
      stats,
      meta: meta || null,
      // Keep raw lines small-ish — cap to first 200 for safety; rest can be rederived from storagePath.
      preview: {
        lines: lines.slice(0, 200),
        truncated: lines.length > 200,
      },
      // diffs: result.diffs ?? null, // (future)
    };

    const db = getFirestore(getApp());
    const col = collection(db, 'venues', venueId, 'orders', orderId, 'reconcileEvents');
    const ref = await addDoc(col, payload);
    return { ok:true, id: ref.id };
  } catch (e:any) {
    console.warn('[persistAfterParse] error', e?.message || e);
    return { ok:false, reason: String(e?.message || e) };
  }
}

export default persistAfterParse;
