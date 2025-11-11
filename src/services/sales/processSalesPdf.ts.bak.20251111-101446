// @ts-nocheck
const API_BASE =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  || 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

export async function processSalesPdf(args: { venueId:string; fileUri:string; filename:string }) {
  const res = await fetch(`${API_BASE}/api/process-sales-pdf`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json().catch(()=>null);
  if (!res.ok || !json) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json;
}
