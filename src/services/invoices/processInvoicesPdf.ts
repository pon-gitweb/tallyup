const API_BASE =
  process.env.EXPO_PUBLIC_AI_URL ||
  'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

export type PdfProcessResult = {
  invoice: { source: 'pdf'; storagePath: string; poNumber?: string | null };
  lines: Array<{ code?: string; name: string; qty: number; unitPrice?: number }>;
  matchReport: { warnings?: string[] } | null;
  confidence: number;
  warnings: string[];
};

export async function processInvoicesPdfREST(input: {
  venueId: string;
  orderId: string;
  storagePath: string;
}): Promise<PdfProcessResult> {
  const res = await fetch(`${API_BASE}/api/process-invoices-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`process-invoices-pdf failed: ${res.status} ${msg}`);
  }
  return res.json();
}

/** Back-compat shim: keep the old name so existing call sites don't break */
export const processInvoicesPdf = processInvoicesPdfREST;

export default processInvoicesPdf;
