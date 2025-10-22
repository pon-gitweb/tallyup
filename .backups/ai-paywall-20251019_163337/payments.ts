import { AI_BASE_URL } from "../config/ai";

export async function validatePromoCode(params: { uid: string; venueId: string; code: string }) {
  const resp = await fetch(`${AI_BASE_URL}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Promo validation failed (${resp.status})`);
  return data as { ok: boolean; entitled?: boolean; code?: string };
}

export async function createCheckout(params: { uid: string; venueId: string; plan: "monthly" | "yearly"; promoCode?: string | null }) {
  const resp = await fetch(`${AI_BASE_URL}/api/dev/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Checkout failed (${resp.status})`);
  return data as { ok: boolean; promoApplied?: boolean; amountCents?: number; checkoutUrl?: string | null };
}

export async function openBillingPortal(params: { uid: string; venueId: string }) {
  const resp = await fetch(`${AI_BASE_URL}/api/dev/portal-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Portal URL failed (${resp.status})`);
  return data as { ok: boolean; url: string };
}

export async function fetchEntitlement(venueId: string) {
  const resp = await fetch(`${AI_BASE_URL}/api/entitlement?venueId=${encodeURIComponent(venueId)}`);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error || data?.message || `Entitlement check failed (${resp.status})`);
  return data as { ok: boolean; entitled: boolean };
}
