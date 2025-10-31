import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

type ProcessInvoicesCsvArgs = { venueId: string; orderId: string; storagePath: string; };

export type ParsedInvoiceLine = {
  name: string; qty: number; unitPrice?: number; code?: string;
  matched?: { productId?: string; confidence?: number; reason?: string };
};

export type ParsedInvoicePayload = {
  invoice: { total?: number; subtotal?: number; gst?: number; poNumber?: string | null; poDate?: string | null; supplierId?: string | null; source?: 'csv'; };
  lines: ParsedInvoiceLine[];
  matchReport?: any;
  confidence?: number;
};

export async function processInvoicesCsv(args: ProcessInvoicesCsvArgs): Promise<ParsedInvoicePayload> {
  const fn = httpsCallable(getFunctions(getApp()), 'processInvoicesCsv');
  const res: any = await fn(args);
  return res?.data as ParsedInvoicePayload;
}
