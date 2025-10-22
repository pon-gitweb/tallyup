// src/config/ai.ts
// Single source of truth for AI URLs (RN/Expo reads EXPO_PUBLIC_* at build time)

const fromEnv = (process.env.EXPO_PUBLIC_AI_URL || '').trim();

// For physical Android + `adb reverse`, localhost is correct.
export const AI_BASE_URL =
  fromEnv ||
  'http://localhost:3001';

export const AI_ENTITLEMENT_URL    = `${AI_BASE_URL}/api/entitlement`;
export const AI_PROMO_URL          = `${AI_BASE_URL}/api/validate-promo`;
export const AI_SUGGEST_ORDERS_URL = `${AI_BASE_URL}/api/suggest-orders`;

console.log('[AI Config] AI_BASE_URL =', AI_BASE_URL);
