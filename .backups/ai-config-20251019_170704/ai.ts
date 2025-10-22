/**
 * AI config — single source of truth for all dev endpoints.
 * Expo will inline EXPO_PUBLIC_AI_URL at build time.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_AI_URL || "http://localhost:3001";

/** Base URL for the local AI dev server */
export const AI_BASE_URL = RAW_BASE.replace(/\/$/, "");

/** Paywall / promo / entitlement */
export const AI_PROMO_URL = `${AI_BASE_URL}/api/validate-promo`;
export const AI_ENTITLEMENT_URL = `${AI_BASE_URL}/api/entitlement`;
export const AI_DEV_CHECKOUT_URL = `${AI_BASE_URL}/api/dev/create-checkout`;
export const AI_DEV_PORTAL_URL = `${AI_BASE_URL}/api/dev/portal-url`;

/** AI Suggested Orders (server stub) */
export const AI_SUGGEST_ORDERS_URL = `${AI_BASE_URL}/api/suggest-orders`;

/** Optional: convenience builder (keeps callers tidy) */
export function aiUrl(path: string) {
  return `${AI_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
