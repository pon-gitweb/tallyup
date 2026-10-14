/**
 * Utility helpers for product field access.
 * Centralises the parLevel / par dual-read so all callers stay consistent.
 */

/**
 * Read the PAR level from a product document.
 * Prefers `parLevel` (canonical field) over legacy `par`.
 * Returns null when neither is set or the value is not a finite number.
 */
export function getParLevel(p: any): number | null {
  const v = p?.parLevel ?? p?.par;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
