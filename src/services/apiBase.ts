/**
 * Shared API base + JSON helpers for parsers.
 * Rules:
 * - Prefer EXPO_PUBLIC_AI_URL if present; trim trailing slash.
 * - Fallback to Cloud Functions URL (project default).
 * - Allow callers to use either "/path" or "path" (we normalize).
 */

const FALLBACK = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

export function apiBase(): string {
  const env = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
    ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/,'')
    : '';
  return env || FALLBACK.replace(/\/+$/,'');
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/,'');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

export async function postJson<T=any>(url: string, body: any): Promise<{ ok: boolean; status: number; json: T|null; text: string|null; }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = null, text: string | null = null;
  try { json = await res.json(); } catch { try { text = await res.text(); } catch { text = null; } }
  return { ok: res.ok, status: res.status, json, text };
}
