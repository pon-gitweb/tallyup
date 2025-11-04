// Identical style to products: POST to Express with storage fullPath
type ProcessInvoicesCsvArgs = { venueId: string; orderId: string; storagePath: string };
type ParsedInvoicePayload = any;

const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/, '')
  : '';

async function postJson(url:string, body:any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

export async function processInvoicesCsv(args: ProcessInvoicesCsvArgs): Promise<ParsedInvoicePayload> {
  if (!BASE) throw new Error('Missing EXPO_PUBLIC_AI_URL');

  const primary = `${BASE}/process-invoices-csv`;
  const fallback = `${BASE}/api/process-invoices-csv`;

  let res = await postJson(primary, args);
  if (res.status === 404) {
    if (__DEV__) console.log('[processInvoicesCsv] primary 404, trying fallback', fallback);
    res = await postJson(fallback, args);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
