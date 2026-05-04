type ProcessInvoicePdfArgs = { venueId: string; orderId: string; storagePath: string };
type ParsedInvoicePayload = any;

const _FB = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
const BASE = ((typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL)
  : _FB).replace(/\/+$/, '');

export async function processInvoicePdf(args: ProcessInvoicePdfArgs): Promise<ParsedInvoicePayload> {
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
