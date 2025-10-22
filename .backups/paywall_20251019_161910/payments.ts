// src/services/payments.ts
import { AI_BASE_URL, AI_PROMO_URL } from "../config/ai";

/**
 * Validate a promo code (server-backed).
 * Expects server response: { ok: true, entitled: boolean, code?: string }
 */
export async function validatePromoCode(params: { uid: string; venueId: string; code: string }) {
  const { uid, venueId, code } = params;
  const resp = await fetch(AI_PROMO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, venueId, code })
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.error || data?.message || `Promo validation failed (${resp.status})`;
    throw new Error(msg);
  }
  return data as { ok: boolean; entitled?: boolean; code?: string };
}

/**
 * Create a dev checkout (or apply a dev promo) and return a URL to open.
 * Endpoint: POST /api/dev/create-checkout
 * Returns: { ok: true, promoApplied: boolean, amountCents: number, checkoutUrl?: string }
 */
export async function createCheckout(params: {
  uid: string;
  venueId: string;
  plan: 'monthly' | 'yearly';
  promoCode?: string | null;
}) {
  const resp = await fetch(`${AI_BASE_URL}/api/dev/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.error || data?.message || `Checkout failed (${resp.status})`;
    throw new Error(msg);
  }
  return data as {
    ok: boolean;
    promoApplied?: boolean;
    amountCents?: number;
    checkoutUrl?: string | null;
  };
}

/**
 * Get a dev billing portal URL.
 * Endpoint: POST /api/dev/portal-url
 * Returns: { ok: true, url: string }
 */
export async function openBillingPortal(params: { uid: string; venueId: string }) {
  const resp = await fetch(`${AI_BASE_URL}/api/dev/portal-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.error || data?.message || `Portal URL failed (${resp.status})`;
    throw new Error(msg);
  }
  return data as { ok: boolean; url: string };
}
