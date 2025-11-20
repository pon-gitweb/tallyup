// Minimal shape used by persistFastReceiveSnapshot.
// This keeps bundler/module resolution happy without constraining the API.
export type ParsedInvoicePayload = {
  invoice?: {
    source?: 'csv' | 'pdf' | 'manual' | string;
    storagePath?: string;
    poNumber?: string | null;
    confidence?: number | null;
    warnings?: string[] | null;
  } | null;
  lines?: Array<{
    code?: string;
    name?: string;
    qty?: number;
    unitPrice?: number;
  }> | null;
  matchReport?: any;
  confidence?: number | null;
  warnings?: string[] | null;
};
