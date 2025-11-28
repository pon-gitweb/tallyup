// @ts-nocheck

// Minimal REST shim (same style as sales CSV & invoices)
const BASE =
  (typeof process !== 'undefined' &&
    (process as any).env?.EXPO_PUBLIC_AI_URL) ||
  'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

function apiBase(): string {
  return String(BASE).replace(/\/+$/, '');
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

export async function processSalesPdf(args: {
  venueId: string;
  fileUri: string;
  filename: string;
}) {
  const base = apiBase();
  if (!base) {
    throw new Error(
      'Sales PDF parsing API not configured. Please export a CSV sales report from your POS and upload that instead.'
    );
  }

  const primary = `${base}/process-sales-pdf`;
  const fallback = `${base}/api/process-sales-pdf`;

  if (__DEV__)
    console.log('[processSalesPdf] calling', primary, {
      venueId: args.venueId,
      filename: args.filename,
    });

  let res = await postJson(primary, args);

  // If primary 404s, try the /api/* path (Express mounted router)
  if (res.status === 404) {
    if (__DEV__)
      console.log(
        '[processSalesPdf] primary 404, trying fallback',
        fallback
      );
    res = await postJson(fallback, args);
  }

  const text = await res.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error payload
  }

  if (!res.ok || !json || json.ok === false) {
    // Nice message if both routes are effectively missing
    if (res.status === 404) {
      throw new Error(
        'Sales PDF parsing is not yet enabled for this environment. Please export a CSV sales report from your POS and upload that instead.'
      );
    }

    const msg =
      (json && (json.error || json.message)) ||
      `HTTP ${res.status}`;
    throw new Error(`process-sales-pdf failed: ${msg}`);
  }

  return json;
}

export default processSalesPdf;
