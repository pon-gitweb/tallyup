import { AI_BASE_URL } from "../config/ai";
import { getAuth } from "firebase/auth";

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
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  quantity?: number;
}) {
  const idToken = await getAuth().currentUser?.getIdToken();
  const resp = await fetch(`${AI_BASE_URL}/api/stripe/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Checkout failed (${resp.status})`);
  return data as { ok: boolean; sessionId?: string; url?: string | null };
}

/** POST /api/stripe/add-subscription-item → { ok, subscriptionId } */
export async function addSubscriptionItem(params: {
  uid: string;
  venueId: string;
  priceId: string;
  quantity?: number;
}) {
  const idToken = await getAuth().currentUser?.getIdToken();
  const resp = await fetch(`${AI_BASE_URL}/api/stripe/add-subscription-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Add subscription item failed (${resp.status})`);
  return data as { ok: boolean; subscriptionId?: string };
}

/** GET /api/stripe/portal?venueId=...&returnUrl=... → { ok, url } */
export async function openBillingPortal(params: { uid: string; venueId: string; returnUrl?: string }) {
  const qs = new URLSearchParams({ venueId: params.venueId });
  if (params.returnUrl) qs.set("returnUrl", params.returnUrl);
  const idToken = await getAuth().currentUser?.getIdToken();
  const resp = await fetch(`${AI_BASE_URL}/api/stripe/portal?${qs.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Portal URL failed (${resp.status})`);
  return data as { ok: boolean; url: string };
}

/** GET /api/entitlement?venueId=... → { ok, entitled } */
export async function fetchEntitlement(venueId: string) {
  const idToken = await getAuth().currentUser?.getIdToken();
  const resp = await fetch(`${AI_BASE_URL}/api/entitlement?venueId=${encodeURIComponent(venueId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await resp.json().catch(() => null);
  if (resp.status === 503) throw new Error(BILLING_NOT_ACTIVE_MSG);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Entitlement check failed (${resp.status})`);
  return data as { ok: boolean; entitled: boolean };
}
