type ProcessInvoicePdfArgs = { venueId: string; orderId: string; storagePath: string };
type ParsedInvoicePayload = any;

const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/, '')
  : '';

export async function processInvoicePdf(args: ProcessInvoicePdfArgs): Promise<ParsedInvoicePayload> {
  if (!BASE) throw new Error('Missing EXPO_PUBLIC_AI_URL');
  const res = await fetch(`${BASE}/process-invoice-pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
