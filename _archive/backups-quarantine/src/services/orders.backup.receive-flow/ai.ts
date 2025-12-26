import Constants from 'expo-constants';

export type AiProjectParams = {
  venueId: string;
  lookbackDays?: number; // default 180, max 730
  items: Array<{
    productId: string;
    onHand: number;
    par?: number | null;
    packSize?: number | null;
    moq?: number | null;
  }>;
};

export async function projectOrdersWithAI(params: AiProjectParams) {
  const extra = (Constants.expoConfig?.extra || {}) as any;
  const url: string | undefined = extra.AI_ORDERS_URL;
  const key: string | undefined = extra.AI_ORDERS_KEY;

  if (!url || !key) {
    return { ok: false as const, reason: 'not_configured' as const };
  }

  const lookback = Math.max(1, Math.min(params.lookbackDays ?? 180, 730));
  const body = JSON.stringify({ ...params, lookbackDays: lookback });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body,
    });
    if (!res.ok) {
      return { ok: false as const, reason: 'http' as const, status: res.status };
    }
    const json = await res.json();
    return { ok: true as const, data: json };
  } catch (e: any) {
    return { ok: false as const, reason: 'network' as const, message: e?.message || String(e) };
  }
}
