const API_BASE =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
    ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/,'')
    : 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

export type ParsedInvoicePayload = {
  invoice: { source: 'csv'|'pdf'; storagePath: string; poNumber?: string|null };
  lines: Array<{ code?: string; name: string; qty: number; unitPrice?: number }>;
  matchReport?: any;
  confidence?: number;
  warnings?: string[];
};

export type ReconcileResponse = {
  ok: boolean;
  reconciliationId?: string;
  summary?: {
    poMatch: boolean;
    counts: { matched: number; unknown: number; priceChanges: number; qtyDiffs: number; missingOnInvoice: number; };
    totals: { ordered: number; invoiced: number; delta: number; };
  };
  error?: string;
};

export async function reconcileInvoiceREST(
  venueId: string,
  orderId: string,
  parsed: ParsedInvoicePayload
): Promise<ReconcileResponse> {
  const url = `${API_BASE}/api/reconcile-invoice`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({
      venueId,
      orderId,
      invoice: {
        source: parsed?.invoice?.source,
        storagePath: parsed?.invoice?.storagePath,
        poNumber: parsed?.invoice?.poNumber ?? null,
        confidence: parsed?.confidence ?? null,
        warnings: parsed?.warnings ?? [],
      },
      lines: parsed?.lines || [],
    }),
  });
  const json = await res.json().catch(()=>null);
  if (!res.ok || !json) {
    return { ok:false, error: json?.error || `HTTP ${res.status}` };
  }
  return json as ReconcileResponse;
}
