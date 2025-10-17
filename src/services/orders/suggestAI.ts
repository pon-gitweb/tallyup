/**
 * AI-based Suggested Orders
 * Returns the same shape as the math-based suggester for seamless fallback.
 * Expo-safe; no native modules.
 */

import { getFirestore, collection, getDocs, Timestamp } from 'firebase/firestore';
import { fetchWithTimeout } from '../../utils/net';
import { AI_SUGGEST_URL, AI_SUGGEST_API_KEY, AI_REQUEST_TIMEOUT_MS, AI_HISTORY_DAYS } from '../../config/ai';

// Safe defaults
const TIMEOUT_MS = AI_REQUEST_TIMEOUT_MS || 12000;
const HISTORY_DAYS = AI_HISTORY_DAYS || 90;

// Normalize AI response
function normalizeAIResult(raw: any) {
  const out = { buckets: {} as Record<string, { supplierName?: string; lines: any[] }>, unassigned: { lines: [] as any[] } };
  if (raw && raw.buckets && typeof raw.buckets === 'object') {
    for (const [sid, b] of Object.entries<any>(raw.buckets)) {
      const lines = Array.isArray(b?.lines) ? b.lines : [];
      out.buckets[String(sid)] = {
        supplierName: typeof b?.supplierName === 'string' ? b.supplierName : undefined,
        lines: lines.map(l => ({
          productId: String(l?.productId || ''),
          productName: String(l?.productName || l?.name || ''),
          qty: Number.isFinite(l?.qty) ? Math.max(1, Math.round(Number(l.qty))) : 1,
          unitCost: Number(l?.unitCost ?? l?.cost ?? 0) || 0,
          cost: Number(l?.unitCost ?? l?.cost ?? 0) || 0,
          packSize: Number.isFinite(l?.packSize) ? Number(l.packSize) : null,
        })).filter(x => x.productId),
      };
    }
  }
  if (Array.isArray(raw?.unassigned?.lines)) {
    out.unassigned.lines = raw.unassigned.lines.map(l => ({
      productId: String(l?.productId || ''),
      productName: String(l?.productName || l?.name || ''),
      qty: Number.isFinite(l?.qty) ? Math.max(1, Math.round(Number(l.qty))) : 1,
      unitCost: Number(l?.unitCost ?? l?.cost ?? 0) || 0,
      cost: Number(l?.unitCost ?? l?.cost ?? 0) || 0,
      packSize: Number.isFinite(l?.packSize) ? Number(l.packSize) : null,
    })).filter(x => x.productId);
  }
  return out;
}

// Helper: latest stock-take timestamp
async function getLatestStockTakeTimestampMs(db: any, venueId: string) {
  let latest: number | null = null;
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    areas.forEach(a => {
      const c = (a.data() || {}).completedAt as Timestamp | undefined;
      if (c?.toMillis) {
        const ms = c.toMillis();
        if (latest == null || ms > latest) latest = ms;
      }
    });
  }
  return latest;
}

// Main AI suggester
export async function buildSuggestedOrdersAI(venueId: string, opts: { roundToPack?: boolean; defaultParIfMissing?: number; historyDays?: number } = {}) {
  const db = getFirestore();
  if (!AI_SUGGEST_URL) throw new Error('AI_SUGGEST_URL not configured');

  const sinceMs = await getLatestStockTakeTimestampMs(db, venueId);
  const payload = {
    venueId,
    roundToPack: !!opts.roundToPack,
    defaultParIfMissing: Number.isFinite(opts.defaultParIfMissing) ? opts.defaultParIfMissing : 6,
    historyDays: opts.historyDays || HISTORY_DAYS,
    since: sinceMs || undefined,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AI_SUGGEST_API_KEY) headers['Authorization'] = `Bearer ${AI_SUGGEST_API_KEY}`;

  const res = await fetchWithTimeout(AI_SUGGEST_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, TIMEOUT_MS);

  if (!res.ok) throw new Error(`AI suggest failed (${res.status})`);
  const data = await res.json();
  return normalizeAIResult(data);
}
