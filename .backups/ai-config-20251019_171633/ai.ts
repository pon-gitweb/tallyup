/**
 * AI config — single source of truth for local dev server endpoints.
 * Expo inlines EXPO_PUBLIC_AI_URL at build time.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_AI_URL || "http://localhost:3001";

/** Base URL for the local AI dev server (no trailing slash) */
export const AI_BASE_URL = String(RAW_BASE).replace(/\/$/, "");

/** Paywall / promo / entitlement */
export const AI_PROMO_URL        = `${AI_BASE_URL}/api/validate-promo`;
export const AI_ENTITLEMENT_URL  = `${AI_BASE_URL}/api/entitlement`;
export const AI_DEV_CHECKOUT_URL = `${AI_BASE_URL}/api/dev/create-checkout`;
export const AI_DEV_PORTAL_URL   = `${AI_BASE_URL}/api/dev/portal-url`;

/** AI Suggested Orders (server stub) */
export const AI_SUGGEST_ORDERS_URL = `${AI_BASE_URL}/api/suggest-orders`;

/** Convenience helper */
export function aiUrl(path: string) {
  return `${AI_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Default export as an OBJECT (so callers using default import can read fields) */
const AI = {
  AI_BASE_URL,
  AI_PROMO_URL,
  AI_ENTITLEMENT_URL,
  AI_DEV_CHECKOUT_URL,
  AI_DEV_PORTAL_URL,
  AI_SUGGEST_ORDERS_URL,
  aiUrl,
};

if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log("[AI Config] base =", AI_BASE_URL, "| suggest =", AI_SUGGEST_ORDERS_URL);
}

export default AI;

// (CJS interop for any require(...) usage)
try { (module as any).exports = AI; } catch {}
