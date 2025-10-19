/**
 * AI config — single source of truth for local dev endpoints.
 * Expo inlines EXPO_PUBLIC_AI_URL at build time.
 */
const RAW_BASE = process.env.EXPO_PUBLIC_AI_URL || "http://localhost:3001";

/** Base URL for the local AI dev server (no trailing slash) */
export const AI_BASE_URL = String(RAW_BASE).replace(/\/$/, "");

/** Named exports (preferred everywhere) */
export const AI_PROMO_URL           = `${AI_BASE_URL}/api/validate-promo`;
export const AI_ENTITLEMENT_URL     = `${AI_BASE_URL}/api/entitlement`;
export const AI_DEV_CHECKOUT_URL    = `${AI_BASE_URL}/api/dev/create-checkout`;
export const AI_DEV_PORTAL_URL      = `${AI_BASE_URL}/api/dev/portal-url`;
export const AI_SUGGEST_ORDERS_URL  = `${AI_BASE_URL}/api/suggest-orders`;

export function aiUrl(path: string) {
  return `${AI_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Hybrid default export: string with properties (covers any legacy usage) */
const AI_DEFAULT: any = new String(AI_BASE_URL);
AI_DEFAULT.AI_BASE_URL          = AI_BASE_URL;
AI_DEFAULT.AI_PROMO_URL         = AI_PROMO_URL;
AI_DEFAULT.AI_ENTITLEMENT_URL   = AI_ENTITLEMENT_URL;
AI_DEFAULT.AI_DEV_CHECKOUT_URL  = AI_DEV_CHECKOUT_URL;
AI_DEFAULT.AI_DEV_PORTAL_URL    = AI_DEV_PORTAL_URL;
AI_DEFAULT.AI_SUGGEST_ORDERS_URL = AI_SUGGEST_ORDERS_URL;
AI_DEFAULT.aiUrl                = aiUrl;

/** Global fallbacks for stray call-sites */
try {
  (globalThis as any).AI_BASE_URL = AI_BASE_URL;
  (globalThis as any).AI_SUGGEST_ORDERS_URL = AI_SUGGEST_ORDERS_URL;
} catch {}

/** Dev log */
if (typeof __DEV__ !== "undefined" && __DEV__) {
  // eslint-disable-next-line no-console
  console.log("[AI Config] base =", AI_BASE_URL, "| suggest =", AI_SUGGEST_ORDERS_URL, "| typeof default =", typeof AI_DEFAULT);
}

export default AI_DEFAULT;
