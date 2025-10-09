import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export type VarianceContext = {
  venueId: string;
  areaId?: string | null;
  productId: string;
  expected: number;
  counted: number;
  unit?: string | null;
  lastDeliveryAt?: string | null;
  lastSalesLookbackDays?: number | null;
  notes?: string | null;
  auditTrail?: Array<{ at: string; action: string; qty?: number; by?: string }>;
};

export type AiResponse = {
  summary: string;
  factors?: string[];
  confidence?: number;
  cachedAt?: string;
};

const API_URL = 'https://australia-southeast1-tallyup-f1463.cloudfunctions.net/aiVarianceExplain';
const CACHE_NS = 'aiVariance';

function cacheKey(ctx: VarianceContext) {
  const k = [
    ctx.venueId, ctx.areaId || '', ctx.productId,
    ctx.expected, ctx.counted, ctx.lastDeliveryAt || '',
    ctx.lastSalesLookbackDays ?? ''
  ].join('|');
  return `${CACHE_NS}:${k}`;
}

/** Honest, offline-safe explain: returns cache if offline, asks server otherwise. */
export async function explainVariance(ctx: VarianceContext): Promise<AiResponse> {
  const key = cacheKey(ctx);
  const net = await NetInfo.fetch();

  if (!net.isConnected) {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached);
    return { summary: 'Limited data: offline. Add recent delivery date, sales window, and audit entries for stronger insights.', confidence: 0 };
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: ctx }),
    });
    if (!res.ok) {
      const cached = await AsyncStorage.getItem(key);
      if (cached) return JSON.parse(cached);
      return { summary: `Service error (${res.status}). Add recent delivery date, sales window, and audit entries for stronger insights.`, confidence: 0 };
    }
    const data = (await res.json()) as AiResponse;
    const withMeta = { ...data, cachedAt: new Date().toISOString() };
    await AsyncStorage.setItem(key, JSON.stringify(withMeta));
    return withMeta;
  } catch {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached);
    return { summary: 'Request failed. Add recent delivery date, sales window, and audit entries for stronger insights.', confidence: 0 };
  }
}
