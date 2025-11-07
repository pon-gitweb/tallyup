// @ts-nocheck
export type ManualLine = {
  code?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
};

export type ManualInvoiceInput = {
  venueId: string;
  orderId: string;
  poNumber?: string | null;
  invoiceNumber?: string | null;
  note?: string | null;
  lines: ManualLine[];
};

export async function processInvoicesManual(input: ManualInvoiceInput) {
  const { venueId, orderId, poNumber, invoiceNumber, note, lines } = input;

  const norm = (lines || []).map(l => ({
    code: l.code ?? null,
    name: l.name ?? '',
    qty: Number(l.qty || 0),
    unitPrice: Number(l.unitPrice || 0),
    total: Number(l.qty || 0) * Number(l.unitPrice || 0),
  }));

  const subtotal = norm.reduce((s, ln) => s + Number(ln.total || 0), 0);

  return {
    ok: true,
    source: 'manual',
    confidence: 1.0, // manual = human-verified
    lines: norm,
    subtotal,
    invoice: {
      source: 'manual',
      number: invoiceNumber || null,
      poNumber: poNumber || null,
      note: note || null,
      venueId,
      orderId,
    },
    metadata: {
      builtAt: Date.now(),
      method: 'manual-editor',
    }
  };
}
