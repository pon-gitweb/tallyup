// @ts-nocheck
/**
 * Entitlement client service (browser-safe, Expo-safe).
 * Uses your stubbed endpoints if available. Falls back to local mocks.
 *
 * Expected stubs (already discussed in Phase-2):
 *  - GET  /api/entitlement?venueId=...&uid=...
 *  - POST /api/validate-promo { code, venueId, uid }
 *
 * Optional future:
 *  - POST /api/checkout/create { planId, interval, venueId, uid }
 */

const jsonFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers||{}) },
    ...init,
  });
  // Handle non-2xx cleanly; stubs may still return JSON errors
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
};

export type EntitlementState = {
  entitled: boolean;
  source?: 'promo'|'trial'|'subscription'|'dev'|'none';
  expiresAt?: number | null; // ms epoch
  plan?: string | null;      // e.g., 'ai_plus'
};

// ---- Public API ------------------------------------------------------------

export async function checkEntitlement(venueId: string, uid: string): Promise<EntitlementState> {
  try {
    const q = `?venueId=${encodeURIComponent(venueId)}&uid=${encodeURIComponent(uid)}`;
    const data = await jsonFetch(`/api/entitlement${q}`);
    return {
      entitled: !!data?.entitled,
      source: data?.source || 'none',
      expiresAt: Number.isFinite(data?.expiresAt) ? Number(data.expiresAt) : null,
      plan: data?.plan || null,
    };
  } catch {
    // Local dev fallback: default locked
    return { entitled: false, source: 'none', expiresAt: null, plan: null };
  }
}

export async function validatePromo(code: string, venueId: string, uid: string): Promise<EntitlementState> {
  try {
    const data = await jsonFetch('/api/validate-promo', {
      method: 'POST',
      body: JSON.stringify({ code, venueId, uid }),
    });
    return {
      entitled: !!data?.entitled,
      source: data?.source || 'promo',
      expiresAt: Number.isFinite(data?.expiresAt) ? Number(data.expiresAt) : null,
      plan: data?.plan || 'ai_plus',
    };
  } catch (e:any) {
    throw new Error(e?.message || 'Invalid promo code');
  }
}

/**
 * Stripe-like checkout starter (stub).
 * Returns a "session" we can pretend to open in a webview or external browser.
 * Server route is optional; if missing, we fabricate a session URL.
 */
export async function startCheckout(args: {
  planId: 'ai_plus';
  interval: 'month' | 'year';
  venueId: string;
  uid: string;
}): Promise<{ sessionUrl: string; sessionId: string }> {
  try {
    const data = await jsonFetch('/api/checkout/create', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    const url = String(data?.url || data?.sessionUrl || '');
    const sid = String(data?.id || data?.sessionId || '');
    if (!url || !sid) throw new Error('Bad session');
    return { sessionUrl: url, sessionId: sid };
  } catch {
    // Fabricate a dev session to keep UX flowing
    const sid = `sess_${Math.random().toString(36).slice(2,10)}`;
    const url = `https://checkout.stripe.dev/session/${sid}?plan=${args.planId}&interval=${args.interval}`;
    return { sessionUrl: url, sessionId: sid };
  }
}
