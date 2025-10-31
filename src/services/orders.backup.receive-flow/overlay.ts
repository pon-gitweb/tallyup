/**
 * Overlay utilities: merge AI overlay into math baseline + client cache + header parsing.
 * Expo-safe (no Node crypto). One concern: overlay merge with rationale + backoff/cache.
 */

export type SupplierLine = {
  productId: string;
  suggestedQty: number;  // baseline qty
  [k: string]: any;
};

export type SupplierBucket = {
  supplierId: string;
  supplierName?: string;
  lines: SupplierLine[];
  rationale?: string; // injected from AI overlay
  [k: string]: any;
};

export type Baseline = {
  venueId: string;
  suppliers: SupplierBucket[];
  [k: string]: any;
};

export type OverlayDelta = {
  supplierId: string;
  rationale?: string;
  lines?: Array<{
    productId: string;
    delta?: number;       // additive diff to baseline suggestedQty
    overrideQty?: number; // absolute override if present
  }>;
};

export type OverlayResponse = {
  deltas: OverlayDelta[];
  overallRationale?: string;
};

export type MergedResult = {
  suppliers: SupplierBucket[];
  meta: {
    usedCache: boolean;
    backoffSeconds: number;
    remaining?: number;
    overallRationale?: string;
  };
};

type CacheEntry = { ts: number; result: MergedResult };
const _cache = new Map<string, CacheEntry>();

/** Lightweight deterministic string hash (djb2) for baseline JSON. */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash >>> 0; // ensure uint32
  }
  return hash.toString(16);
}

/** Build cache key: venueId + hash(baseline JSON). */
export function buildCacheKey(baseline: Baseline): string {
  const json = JSON.stringify(baseline.suppliers, (k, v) => {
    // Keep only fields that affect quantities/rationale
    if (k === 'rationale') return undefined;
    return v;
  });
  return `${baseline.venueId}:${hashString(json)}`;
}

/** Merge AI overlay deltas into baseline. */
export function mergeOverlay(baseline: Baseline, overlay: OverlayResponse | null): SupplierBucket[] {
  if (!overlay || !overlay.deltas || overlay.deltas.length === 0) {
    // nothing to merge
    return baseline.suppliers.map(s => ({ ...s, rationale: s.rationale ?? undefined }));
  }

  // Index suppliers + lines for fast mutation
  const bySupplier = new Map<string, SupplierBucket>();
  const byLine = new Map<string, Map<string, SupplierLine>>(); // supplierId -> productId -> line

  baseline.suppliers.forEach(s => {
    const sCopy: SupplierBucket = { ...s, lines: s.lines.map(l => ({ ...l })) };
    bySupplier.set(s.supplierId, sCopy);
    const map = new Map<string, SupplierLine>();
    sCopy.lines.forEach(l => map.set(l.productId, l));
    byLine.set(s.supplierId, map);
  });

  overlay.deltas.forEach(d => {
    const s = bySupplier.get(d.supplierId);
    if (!s) return;
    if (d.rationale) s.rationale = d.rationale;

    if (d.lines && d.lines.length) {
      const map = byLine.get(d.supplierId);
      d.lines.forEach(ol => {
        if (!map) return;
        const line = map.get(ol.productId);
        if (!line) return;
        if (typeof ol.overrideQty === 'number') {
          line.suggestedQty = Math.max(0, Math.round(ol.overrideQty));
        } else if (typeof ol.delta === 'number') {
          line.suggestedQty = Math.max(0, Math.round((line.suggestedQty || 0) + ol.delta));
        }
      });
    }
  });

  return Array.from(bySupplier.values());
}

/** Parse quota headers safely (lowercase per fetch spec). */
export function parseQuotaHeaders(headers: Headers) {
  const remainingRaw = headers.get('x-ai-remaining') ?? headers.get('X-AI-Remaining');
  const retryRaw = headers.get('x-ai-retry-after') ?? headers.get('X-AI-Retry-After');
  const remaining = remainingRaw != null ? Number(remainingRaw) : undefined;
  const retryAfterSeconds = retryRaw != null ? Number(retryRaw) : 0;
  return { remaining, retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0 };
}

/** Get cached result (if any). */
export function getCache(key: string): MergedResult | null {
  const e = _cache.get(key);
  return e ? e.result : null;
}

/** Set cached result. */
export function setCache(key: string, result: MergedResult) {
  _cache.set(key, { ts: Date.now(), result });
}

/** Main compose helper: decide backoff/cache and produce merged result. */
export function composeMergedResult(
  baseline: Baseline,
  overlay: OverlayResponse | null,
  headers?: Headers
): MergedResult {
  const key = buildCacheKey(baseline);
  const { remaining, retryAfterSeconds } = headers ? parseQuotaHeaders(headers) : { remaining: undefined, retryAfterSeconds: 0 };

  // If server tells us to back off, prefer cached if present
  if (retryAfterSeconds > 0) {
    const cached = getCache(key);
    if (cached) {
      return {
        suppliers: cached.suppliers,
        meta: { usedCache: true, backoffSeconds: retryAfterSeconds, remaining, overallRationale: cached.meta.overallRationale },
      };
    }
    // Return baseline-only with backoff meta (UI can show cooldown)
    return {
      suppliers: baseline.suppliers,
      meta: { usedCache: false, backoffSeconds: retryAfterSeconds, remaining },
    };
  }

  const suppliers = mergeOverlay(baseline, overlay);
  const result: MergedResult = {
    suppliers,
    meta: { usedCache: false, backoffSeconds: 0, remaining, overallRationale: overlay?.overallRationale },
  };
  setCache(key, result);
  return result;
}
