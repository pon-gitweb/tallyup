// src/services/payments.ts
import { AI_BASE_URL, AI_PROMO_URL } from "../config/ai";

// Promo code validation (server-backed)
export async function validatePromoCode(uid: string, venueId: string, code: string) {
  const resp = await fetch(AI_PROMO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, venueId, code })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(()=> '');
    throw new Error(`Promo validation failed (${resp.status}) ${text}`);
  }
  return resp.json(); // { ok:true, entitled:true, code }
}

/**
 * Stubbed checkout creator (pretend-Stripe):
 * Returns a fake hosted URL so your PaymentSheet can "open" it.
 */
export async function createCheckout(uid: string, venueId: string) {
  // You can serve a simple static page from the dev server later.
  // For now, we just return a dev URL to prove the flow.
  const url = `${AI_BASE_URL}/dev-checkout?uid=${encodeURIComponent(uid)}&venueId=${encodeURIComponent(venueId)}`;
  return { ok: true, url };
}

/**
 * Stubbed billing portal:
 */
export async function openBillingPortal(uid: string, venueId: string) {
  const url = `${AI_BASE_URL}/dev-portal?uid=${encodeURIComponent(uid)}&venueId=${encodeURIComponent(venueId)}`;
  return { ok: true, url };
}
