import { AI_BASE_URL } from "../config/ai";

const BILLING_NOT_ACTIVE_MSG =
  "Billing is not yet active. You are on complimentary pilot access.";

/** POST /api/validate-promo → { ok, entitled?: boolean, code?: string } */
export async function validatePromoCode(params: { uid: string; venueId: string; code: string }) {
  const resp = await fetch(`${AI_BASE_URL}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Promo validation failed (${resp.status})`);
  return data as { ok: boolean; entitled?: boolean; code?: string };
}

/** POST /api/stripe/create-checkout-session → { ok, sessionId, url } */
export async function createCheckout(params: {
  uid: string;
  venueId: string;
  plan: "monthly" | "yearly";
  promoCode?: string | null;
  priceId?: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  const resp = await fetch(`${AI_BASE_URL}/api/stripe/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Checkout failed (${resp.status})`);
  return data as { ok: boolean; promoApplied?: boolean; amountCents?: number; checkoutUrl?: string | null; url?: string | null };
}

/** GET /api/stripe/portal?venueId=...&returnUrl=... → { ok, url } */
export async function openBillingPortal(params: { uid: string; venueId: string; returnUrl?: string }) {
  const qs = new URLSearchParams({ venueId: params.venueId });
  if (params.returnUrl) qs.set("returnUrl", params.returnUrl);
  const resp = await fetch(`${AI_BASE_URL}/api/stripe/portal?${qs.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Portal URL failed (${resp.status})`);
  return data as { ok: boolean; url: string };
}

/** GET /api/entitlement?venueId=... → { ok, entitled } */
export async function fetchEntitlement(venueId: string) {
  const resp = await fetch(`${AI_BASE_URL}/api/entitlement?venueId=${encodeURIComponent(venueId)}`);
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Entitlement check failed (${resp.status})`);
  return data as { ok: boolean; entitled: boolean };
}
