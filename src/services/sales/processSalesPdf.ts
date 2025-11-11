// @ts-nocheck
import { apiBase, joinUrl, postJson } from '../apiBase';

export async function processSalesPdf(args: { venueId:string; fileUri:string; filename:string }) {
  const base = apiBase();
  const primary  = joinUrl(base, 'process-sales-pdf');
  const fallback = joinUrl(base, 'api/process-sales-pdf');

  // Try primary then fallback (keeps older deployments working)
  let res = await postJson(primary, args);
  if (!res.ok && res.status === 404) res = await postJson(fallback, args);

  if (!res.ok || !res.json) {
    const msg = (res.json && (res.json.error || res.json.message))
      || res.text
      || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json;
}
