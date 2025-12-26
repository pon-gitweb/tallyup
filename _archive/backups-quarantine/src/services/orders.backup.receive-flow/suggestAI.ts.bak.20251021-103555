// @ts-nocheck
/**
 * runAISuggest(venueId, opts, mode)
 * - mode = 'math' (default): uses in-memory baseline (legacy math)
 * - mode = 'ai': posts baseline to /api/suggest-orders and surfaces meter headers
 *
 * Returns: { buckets, unassigned, meter?: { aiRemaining?: number, retryAfterSeconds?: number } }
 */
import { buildSuggestedOrdersInMemory } from './suggest';
import { fetchJsonWithHeaders } from '../ai';

type Meter = { aiRemaining?: number; retryAfterSeconds?: number };
type CompatBuckets = Record<string, { lines: any[]; supplierName?: string }>;

const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);

function dedupeByProductId(lines:any[]){ const seen=new Set<string>(); const out:any[]=[]; for(const l of Array.isArray(lines)?lines:[]){ const pid=String(l?.productId||''); if(!pid||seen.has(pid))continue; seen.add(pid); out.push(l);} return out; }

/** Normalizes a possibly-legacy shape into { buckets, unassigned } */
function normalizeCompat(compat:any){
  const raw:CompatBuckets = (compat && compat.buckets && typeof compat.buckets==='object') ? compat.buckets : (compat || {});
  const unStart:any[] = Array.isArray(compat?.unassigned?.lines) ? compat.unassigned.lines : [];
  const unPool:any[] = [...unStart];
  const real:CompatBuckets = {};
  Object.entries(raw).forEach(([key, b]:any) => {
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (NO_SUPPLIER_KEYS.has(String(key))) { if (lines.length) unPool.push(...lines); return; }
    if (lines.length > 0) real[key] = { lines: dedupeByProductId(lines), supplierName: b?.supplierName };
  });
  const unassigned = { lines: dedupeByProductId(unPool) };
  return { buckets: real, unassigned };
}

async function buildBaseline(venueId:string){
  const base = await buildSuggestedOrdersInMemory(venueId, { roundToPack: true, defaultParIfMissing: 6 });
  return normalizeCompat(base);
}

/**
 * Main entry
 */
export async function runAISuggest(
  venueId: string,
  opts: any = { historyDays: 28, k: 3, max: 400 },
  mode: 'math' | 'ai' = 'math'
): Promise<{ buckets: CompatBuckets; unassigned: { lines: any[] }; meter?: Meter }> {
  // Always compute math baseline first (used directly for 'math' and as baseline for 'ai')
  const baseline = await buildBaseline(venueId);

  if (mode !== 'ai') {
    return { ...baseline, meter: undefined };
  }

  // Post to cloud and echo back overlay (passthrough today, AI later)
  const { json, headers } = await fetchJsonWithHeaders<any>('/api/suggest-orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ venueId, baseline, opts }),
  });

  const body = json || {};
  const buckets = body?.buckets || baseline.buckets || {};
  const unassigned = body?.unassigned || baseline.unassigned || { lines: [] };

  const hRemaining = headers['x-ai-remaining'];
  const hRetry = headers['x-ai-retry-after'];
  const meter: Meter = {
    aiRemaining: Number.isFinite(Number(hRemaining)) ? Number(hRemaining) : Number(body?.meta?.aiRemaining ?? NaN),
    retryAfterSeconds: Number.isFinite(Number(hRetry)) ? Number(hRetry) : Number(body?.meta?.retryAfterSeconds ?? NaN),
  };

  return { buckets, unassigned, meter };
}
