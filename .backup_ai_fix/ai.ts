// src/config/ai.ts
// Single source of truth for all AI endpoints

// Expo exposes env with the EXPO_PUBLIC_ prefix in-app
const BASE =
  (typeof process !== 'undefined' &&
    (process.env as any)?.EXPO_PUBLIC_AI_URL) ||
  'http://localhost:3001'; // dev default (works with `adb reverse`)

export const AI_BASE_URL = BASE.replace(/\/+$/,'');
export const AI_ENTITLEMENT_URL   = `${AI_BASE_URL}/api/entitlement`;
export const AI_PROMO_URL         = `${AI_BASE_URL}/api/validate-promo`;
export const AI_SUGGEST_ORDERS_URL= `${AI_BASE_URL}/api/suggest-orders`;

// Helpful diagnostic
console.log('[AI Config] AI_BASE_URL =', AI_BASE_URL);
