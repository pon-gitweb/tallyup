// @ts-nocheck
/**
 * runAISuggest(venueId, opts, mode)
 * - mode = 'math' (default): uses in-memory baseline (legacy math)
 * - mode = 'ai': posts baseline to /api/suggest-orders and surfaces meter headers
 *
 * Returns: { buckets, unassigned, meter?: { aiRemaining?: number, retryAfterSeconds?: number } }
 */

import { buildSuggestedOrdersInMemory } from './suggest';
import { AI_SUGGEST_ORDERS_URL } from '../../config/ai';

type Meter = { aiRemaining?: number; retryAfterSeconds?: number };
type CompatBuckets = Record<string, { lines: any[]; supplierName?: string }>;

const NO_SUPPLIER_KEYS = new Set([
  'unassigned',
  '__no_supplier__',
  'no_supplier',
  'none',
  'null',
  'undefined',
]);

function dedupeByProductId(lines: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const pid = String(l?.productId || '');
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(l);
  }
  return out;
}

/** Normalizes a possibly-legacy shape into { buckets, unassigned } */
function normalizeCompat(compat: any) {
  const raw: CompatBuckets =
    compat && compat.buckets && typeof compat.buckets === 'object'
      ? compat.buckets
      : (compat || {});
  const unStart: any[] = Array.isArray(compat?.unassigned?.lines)
    ? compat.unassigned.lines
    : [];
  const unPool: any[] = [...unStart];
  const real: CompatBuckets = {};
  Object.entries(raw).forEach(([key, b]: any) => {
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (NO_SUPPLIER_KEYS.has(String(key))) {
      if (lines.length) unPool.push(...lines);
      return;
    }
    if (lines.length > 0) {
      real[key] = {
        lines: dedupeByProductId(lines),
        supplierName: b?.supplierName,
      };
    }
  });
  const unassigned = { lines: dedupeByProductId(unPool) };
  return { buckets: real, unassigned };
}

async function buildBaseline(venueId: string) {
  console.log('[AISuggest] buildBaseline ENTER', { venueId });
  const base = await buildSuggestedOrdersInMemory(venueId, {
    roundToPack: true,
    defaultParIfMissing: 6,
  });
  const normalized = normalizeCompat(base);
  const totalLines =
    Object.values(normalized.buckets || {}).reduce(
      (acc: any, b: any) =>
        acc + (Array.isArray(b?.lines) ? b.lines.length : 0),
      0
    ) +
    (Array.isArray(normalized.unassigned?.lines)
      ? normalized.unassigned.lines.length
      : 0);
  console.log('[AISuggest] buildBaseline DONE', {
    venueId,
    buckets: Object.keys(normalized.buckets || {}).length,
    totalLines,
  });
  return normalized;
}

/**
 * Main entry
 */
export async function runAISuggest(
  venueId: string,
  opts: any = { historyDays: 28, k: 3, max: 400 },
  mode: 'math' | 'ai' = 'math'
): Promise<{ buckets: CompatBuckets; unassigned: { lines: any[] }; meter?: Meter }> {
  console.log('[AISuggest] runAISuggest ENTER', { venueId, mode, opts });

  // Always compute math baseline first (used directly for 'math' and as baseline for 'ai')
  const baseline = await buildBaseline(venueId);

  if (mode !== 'ai') {
    console.log('[AISuggest] mode=math → returning baseline only');
    return { ...baseline, meter: undefined };
  }

  try {
    console.log('[AISuggest] mode=ai → POST', { url: AI_SUGGEST_ORDERS_URL });

    const resp = await fetch(AI_SUGGEST_ORDERS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ venueId, baseline, opts }),
    });

    const headersObj: Record<string, string> = {};
    try {
      resp.headers.forEach((value, key) => {
        headersObj[key.toLowerCase()] = value;
      });
    } catch {
      // Ignore header extraction failure
    }

    const json = await resp.json().catch(() => null as any);
    if (!resp.ok) {
      const msg =
        json?.error || json?.message || `Suggest-orders failed (${resp.status})`;
      console.log('[AISuggest] mode=ai HTTP ERROR', {
        status: resp.status,
        msg,
      });
      throw new Error(msg);
    }

    const body = json || {};
    const buckets = body?.buckets || baseline.buckets || {};
    const unassigned = body?.unassigned || baseline.unassigned || { lines: [] };

    const hRemaining = headersObj['x-ai-remaining'];
    const hRetry = headersObj['x-ai-retry-after'];
    const meter: Meter = {
      aiRemaining: Number.isFinite(Number(hRemaining))
        ? Number(hRemaining)
        : Number(body?.meta?.aiRemaining ?? NaN),
      retryAfterSeconds: Number.isFinite(Number(hRetry))
        ? Number(hRetry)
        : Number(body?.meta?.retryAfterSeconds ?? NaN),
    };

    console.log('[AISuggest] mode=ai DONE', {
      buckets: Object.keys(buckets || {}).length,
      unassignedLines: Array.isArray(unassigned?.lines)
        ? unassigned.lines.length
        : 0,
      meter,
    });

    return { buckets, unassigned, meter };
  } catch (err: any) {
    console.log('[AISuggest] mode=ai ERROR', {
      message: String(err?.message || err || 'Unknown error'),
    });
    // Let the caller show the "AI unavailable" alert and still have baseline
    throw err;
  }
}
