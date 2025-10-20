/**
 * Hybrid AI Suggested Orders (Expo-safe)
 * - Builds math baseline locally
 * - Sends compact context to AI server overlay
 * - Returns { buckets, unassigned } normalized for SuggestedOrderScreen
 */
import { buildSuggestedOrdersInMemory } from './suggest';

type Line = {
  productId: string;
  productName?: string;
  qty: number;           // whole units
  unitCost?: number;     // optional, used for rationale & value calc
  packSize?: number|null;
};

type Bucket = { lines: Line[]; supplierName?: string };
type Buckets = Record<string, Bucket>;

type RunOpts = {
  historyDays?: number;  // sales lookback (hint for server overlay)
  k?: number;            // top-k or smoothing factor (server-defined)
  max?: number;          // max lines server should consider
  roundToPack?: boolean; // forward to math baseline
  defaultParIfMissing?: number; // fallback par
  signal?: AbortSignal;
};

type AIServerResponse = {
  buckets?: Buckets;
  unassigned?: { lines: Line[] } | null;
  meta?: {
    rationale?: string;
    factors?: string[];
    aiRemaining?: number|null;
    retryAfterSeconds?: number|null;
  };
};

const envUrl = (typeof process !== 'undefined' && (process as any).env
  && ((process as any).env.EXPO_PUBLIC_AI_URL || (process as any).env.AI_URL))
  || 'http://localhost:3001';

const AI_ENDPOINT = `${envUrl.replace(/\/+$/,'')}/api/suggest-orders`;

// small helpers
const m1 = (v:any)=>{ const x=Number(v); return Number.isFinite(x)?Math.max(1,Math.round(x)):1; };
const s = (v:any,d='')=> typeof v==='string'?v:d;

function toPortable(lines: any[]): Line[] {
  const out: Line[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(lines) ? lines : []) {
    const productId = s(raw?.productId || raw?.id || '', '');
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    out.push({
      productId,
      productName: s(raw?.productName || raw?.name || raw?.sku || productId, productId),
      qty: m1(raw?.qty),
      unitCost: Number.isFinite(raw?.unitCost ?? raw?.cost) ? Number(raw?.unitCost ?? raw?.cost) : undefined,
      packSize: Number.isFinite(raw?.packSize) ? Number(raw?.packSize) : null,
    });
  }
  return out;
}

function normalizeResponse(json: any): { buckets: Buckets; unassigned: { lines: Line[] } } {
  const buckets: Buckets = {};
  const rawBuckets = json?.buckets && typeof json.buckets === 'object' ? json.buckets : {};
  for (const [sid, b] of Object.entries<any>(rawBuckets)) {
    const lines = toPortable(b?.lines || []);
    if (lines.length) buckets[String(sid)] = { lines, supplierName: s(b?.supplierName, undefined as any) };
  }
  const unassignedLines = toPortable(json?.unassigned?.lines || []);
  return { buckets, unassigned: { lines: unassignedLines } };
}

/**
 * Build a compact baseline payload from math result.
 */
async function buildBaseline(venueId: string, opts: RunOpts) {
  const compat: any = await buildSuggestedOrdersInMemory(venueId, {
    roundToPack: opts?.roundToPack ?? true,
    defaultParIfMissing: opts?.defaultParIfMissing ?? 6,
  });

  const srcBuckets: Record<string, { lines: any[]; supplierName?: string }> =
    (compat && compat.buckets && typeof compat.buckets === 'object') ? compat.buckets : (compat || {});

  // Collect unassigned from either explicit pool or any bucket with "no supplier" keys
  const NO_SUP = new Set(['unassigned', '__no_supplier__', 'no_supplier', 'none', 'null', 'undefined', '']);
  const unassignedPool: any[] = Array.isArray(compat?.unassigned?.lines) ? compat.unassigned.lines : [];

  const baselineBuckets: Buckets = {};
  for (const [sid, b] of Object.entries<any>(srcBuckets)) {
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (NO_SUP.has(String(sid))) { if (lines.length) unassignedPool.push(...lines); continue; }
    const port = toPortable(lines);
    if (port.length) baselineBuckets[String(sid)] = { lines: port, supplierName: s(b?.supplierName, undefined as any) };
  }

  return {
    buckets: baselineBuckets,
    unassigned: { lines: toPortable(unassignedPool) },
  };
}

/**
 * Main entry — called by SuggestedOrderScreen
 *
 * Returns normalized { buckets, unassigned } so the screen can keep working unchanged.
 * Attaches (non-breaking) ._meta for future quota/meter use.
 */
export async function runAISuggest(venueId: string, opts: RunOpts = {}): Promise<{
  buckets: Buckets; unassigned: { lines: Line[] }; _meta?: AIServerResponse['meta'];
}> {
  if (!venueId) throw new Error('Missing venueId');

  // 1) Build math baseline locally
  const baseline = await buildBaseline(venueId, opts);

  // 2) Prepare overlay request (compact, Expo-safe)
  const body = {
    venueId,
    params: {
      historyDays: opts.historyDays ?? 28,
      k: opts.k ?? 3,
      max: opts.max ?? 400,
    },
    baseline, // math-first payload
  };

  // 3) Fetch with timeout & graceful degradation
  const controller = new AbortController();
  const signal = opts.signal || controller.signal;
  const to = setTimeout(() => { try { controller.abort(); } catch {} }, 12_000);

  let aiRemaining: number|null = null;
  let retryAfterSeconds: number|null = null;
  try {
    const resp = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-venue-id': String(venueId),
      },
      body: JSON.stringify(body),
      signal,
    });

    // capture quota headers for future UI
    const rem = resp.headers.get('x-ai-remaining');
    const ra = resp.headers.get('x-ai-retry-after');
    aiRemaining = (rem != null && rem !== '') ? Number(rem) : null;
    retryAfterSeconds = (ra != null && ra !== '') ? Number(ra) : null;

    if (!resp.ok) {
      // On rate-limit, return math baseline instead of exploding
      if (resp.status === 429) {
        return { ...baseline, _meta: { aiRemaining, retryAfterSeconds, rationale: 'rate_limited' } };
      }
      const text = await resp.text().catch(()=> '');
      throw new Error(text || `AI server error (${resp.status})`);
    }

    const json = await resp.json().catch(() => ({}));
    const normalized = normalizeResponse(json);
    return { ...normalized, _meta: { ...(json?.meta||{}), aiRemaining, retryAfterSeconds } };
  } catch (e:any) {
    // Network or abort → fall back to math baseline
    return { ...baseline, _meta: { rationale: 'fallback_math', aiRemaining, retryAfterSeconds } };
  } finally {
    clearTimeout(to);
  }
}
