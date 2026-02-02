// @ts-nocheck
const rawBase =
  process.env.EXPO_PUBLIC_AI_URL ||
  process.env.EXPO_PUBLIC_AI_BASE ||
  "http://localhost:3001";

export const AI_BASE = rawBase.replace(/\/$/, "");

export const AI_SUGGEST_URL =
  process.env.EXPO_PUBLIC_AI_SUGGEST_URL || `${AI_BASE}/api/suggest-orders`;

export const AI_VARIANCE_EXPLAIN_URL =
  process.env.EXPO_PUBLIC_AI_VARIANCE_EXPLAIN_URL || `${AI_BASE}/api/variance-explain`;

if (__DEV__) {
  console.log(
    "[AI Config] base =",
    AI_BASE,
    "| suggest =",
    AI_SUGGEST_URL,
    "| variance =",
    AI_VARIANCE_EXPLAIN_URL
  );
}
