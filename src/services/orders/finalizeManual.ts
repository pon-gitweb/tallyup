// @ts-nocheck
import { getFirestore, doc, updateDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';

export async function finalizeReceiveFromManual({
  venueId, orderId, parsed
}: {
  venueId: string; orderId: string; parsed: any;
}) {
  const db = getFirestore();

  // Optional: write an invoice doc for audit; non-fatal if this fails
  try {
    const invCol = collection(db, 'venues', venueId, 'orders', orderId, 'invoices');
    await addDoc(invCol, {
      type: 'manual',
      createdAt: serverTimestamp(),
      invoice: parsed?.invoice || null,
      lines: parsed?.lines || [],
      subtotal: parsed?.subtotal ?? null,
      source: 'manual',
      confidence: parsed?.confidence ?? 1.0,
      metadata: parsed?.metadata || null,
    });
  } catch (e) {
    console.warn('[finalizeManual] invoice audit write failed:', e);
  }

  // Finalize order
  const ref = doc(db, 'venues', venueId, 'orders', orderId);
  await updateDoc(ref, {
    status: 'received',
    receivedAt: serverTimestamp(),
    receiveMeta: {
      method: 'manual',
      source: 'manual',
      confidence: parsed?.confidence ?? 1.0,
      subtotal: parsed?.subtotal ?? null,
      invoiceNo: parsed?.invoice?.number ?? null,
      poNumber: parsed?.invoice?.poNumber ?? null,
    }
  });

  return { ok: true };
}
