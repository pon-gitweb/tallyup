// @ts-nocheck
// Minimal REST shim; expects your server to expose /process-sales-csv (or /api/process-sales-csv fallback)
const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/,'')
  : '';

async function postJson(url:string, body:any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

export async function processSalesCsv(args: { venueId:string; fileUri:string; filename:string }) {
  if (!BASE) throw new Error('Missing EXPO_PUBLIC_AI_URL');
  const primary = `${BASE}/process-sales-csv`;
  const fallback = `${BASE}/api/process-sales-csv`;
  let res = await postJson(primary, args);
  if (res.status === 404) res = await postJson(fallback, args);
  const json = await res.json().catch(()=>null);
  if (!res.ok || !json || json.ok === false) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
