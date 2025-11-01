import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

type ProcessInvoicesPdfArgs = { venueId: string; orderId: string; storagePath: string; };

export type ParsedInvoiceLine = {
  name: string; qty: number; unitPrice?: number; code?: string;
  matched?: { productId?: string; lineId?: string; confidence?: number; reason?: string };
};

export type ParsedInvoicePayload = {
  invoice?: { total?: number; subtotal?: number; gst?: number; poNumber?: string | null; poDate?: string | null; source?: 'pdf' };
  lines: ParsedInvoiceLine[];
  matchReport?: any;
  confidence?: number;
};

export async function processInvoicesPdf(args: ProcessInvoicesPdfArgs): Promise<ParsedInvoicePayload> {
  const fn = httpsCallable(getFunctions(getApp()), 'processInvoicesPdf');
  const res: any = await fn(args);
  return res?.data as ParsedInvoicePayload;
}
