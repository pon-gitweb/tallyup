import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { withTimeout } from '../http/withTimeout';

type ProcessInvoicesPdfArgs = { venueId: string; orderId: string; storagePath: string; };

export type ParsedInvoiceLine = {
  name: string;
  qty: number;
  unitPrice?: number;
  code?: string;
  matched?: { productId?: string; confidence?: number; reason?: string };
};

export type ParsedInvoicePayload = {
  invoice: {
    total?: number;
    subtotal?: number;
    gst?: number;
    poNumber?: string | null;
    poDate?: string | null;
    supplierId?: string | null;
    source?: 'pdf';
    storagePath?: string;
  };
  lines: ParsedInvoiceLine[];
  matchReport?: any;
  confidence?: number;
  warnings?: string[];
};

export async function processInvoicesPdf(args: ProcessInvoicesPdfArgs): Promise<ParsedInvoicePayload> {
  const { venueId, orderId, storagePath } = args;

  try {
    const fn = httpsCallable(getFunctions(getApp()), 'processInvoicesPdf');
    const res: any = await withTimeout(fn({ venueId, orderId, storagePath }), 25000, 'processInvoicesPdf');
    const payload = res?.data ?? res;
    if (payload) {
      return {
        invoice: { source: 'pdf', storagePath, ...(payload?.invoice || {}) },
        lines: payload?.lines || [],
        matchReport: payload?.matchReport,
        confidence: payload?.confidence,
        warnings: payload?.warnings || []
      } as ParsedInvoicePayload;
    }
  } catch (err) {
    if (__DEV__) console.log('[processInvoicesPdf] callable failed, falling back to stub:', err);
  }

  // Fallback stub to unblock Phase-2 wiring
  return {
    invoice: {
      source: 'pdf',
      storagePath,
      poNumber: null,
    },
    lines: [],
    matchReport: null,
    confidence: 0.0,
    warnings: ['PDF parser not available; using local stub.'],
  };
}
