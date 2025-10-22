// NOTE: Keep this Node/Jest friendly (no expo/virtual/env import).
// Reads from process.env when present (Jest), falls back otherwise.

const RUNTIME_AI_BASE =
  (typeof process !== "undefined" && process && process.env && process.env.EXPO_PUBLIC_AI_URL)
    ? String(process.env.EXPO_PUBLIC_AI_URL)
    : "http://localhost:3001";

/** Build absolute URL from a path or absolute input. */
export function buildAiUrl(path: string): string {
  if (!path) return RUNTIME_AI_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const a = String(RUNTIME_AI_BASE).replace(/\/+$/,'');
  const b = String(path).replace(/^\/+/, '');
  return `${a}/${b}`;
}

// Optional helper used by clients that want to log what base we resolved.
export const __aiBase = RUNTIME_AI_BASE;
