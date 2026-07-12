/**
 * Credit note creation — writes a `type: 'credit_note'` document to
 * venues/{venueId}/invoices with negative quantities/amounts, and reverses
 * stock counts for the returned quantities (mirrors the increment used by
 * src/services/orders/receive.ts for normal deliveries).
 */
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, collection, addDoc, getDocs, writeBatch,
  serverTimestamp, increment, Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export type CreditNoteLineInput = {
  productId?: string | null;
  name: string;
  qtyReturned: number;          // positive — quantity being returned/reversed
  creditAmountPerUnit: number;  // positive — credit value per unit
};

export type CreditNoteInput = {
  venueId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  originalInvoiceId?: string | null;
  date: string; // YYYY-MM-DD
  notes?: string | null;
  lines: CreditNoteLineInput[];
};

export async function createCreditNote(input: CreditNoteInput): Promise<{ ok: boolean; invoiceId?: string; error?: string }> {
  const { venueId, supplierId, supplierName, originalInvoiceId, date, notes, lines } = input;
  if (!venueId) return { ok: false, error: 'Missing venueId' };
  const validLines = (lines || []).filter(l => l.name?.trim() && Math.abs(Number(l.qtyReturned) || 0) > 0);
  if (!validLines.length) return { ok: false, error: 'Add at least one line with a quantity returned' };

  const db = getFirestore(getApp());
  const uid = getAuth()?.currentUser?.uid || null;

  const dateTs = (() => {
    try { return Timestamp.fromDate(new Date(date + 'T00:00:00')); } catch { return Timestamp.now(); }
  })();

  // Credit notes carry negative line quantities and amounts — the unit credit
  // amount stays positive, the line total (qty * unitCost) comes out negative.
  const creditLines = validLines.map(l => {
    const qty = -Math.abs(Number(l.qtyReturned) || 0);
    const unitCost = Math.abs(Number(l.creditAmountPerUnit) || 0);
    return {
      productId: l.productId || null,
      name: l.name,
      productName: l.name,
      qty,
      unitCost,
      cost: unitCost,
      lineTotal: qty * unitCost,
    };
  });

  const totalAmount = creditLines.reduce((sum, l) => sum + l.lineTotal, 0);

  try {
    const invRef = await addDoc(collection(db, 'venues', venueId, 'invoices'), {
      type: 'credit_note',
      supplierId: supplierId || null,
      supplierName: supplierName || null,
      originalInvoiceId: originalInvoiceId || null,
      invoiceDate: date || null,
      invoiceDateTimestamp: dateTs,
      date: dateTs,
      status: 'posted',
      source: 'credit-note-manual',
      totalAmount,
      notes: notes || null,
      venueId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(uid ? { createdBy: uid } : {}),
    });

    const lineBatch = writeBatch(db);
    creditLines.forEach((l) => {
      const lineRef = doc(collection(db, 'venues', venueId, 'invoices', invRef.id, 'lines'));
      lineBatch.set(lineRef, l);
    });
    await lineBatch.commit();

    // Reverse stock — subtract returned quantity from matching item.
    // Festival: decrement lastCount (live stock model).
    // Venue: decrement incomingQty (physical count model).
    try {
      const venueSnap = await getDoc(doc(db, 'venues', venueId));
      const isFestival = (venueSnap.data() as any)?.venueType === 'festival';
      const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      const stockBatch = writeBatch(db);
      let stockUpdates = 0;

      for (const dep of depsSnap.docs) {
        const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
        for (const area of areasSnap.docs) {
          const itemsSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'),
          );
          itemsSnap.forEach(itemDoc => {
            const item = itemDoc.data() as any;
            const itemProductId = String(item.productId || item.productLinkId || '');
            const itemName = (item.name || '').toLowerCase().trim();

            const matchedLine = creditLines.find(l =>
              (l.productId && itemProductId && l.productId === itemProductId) ||
              (l.name && itemName && l.name.toLowerCase().trim() === itemName),
            );
            if (matchedLine) {
              stockBatch.update(itemDoc.ref, {
                ...(isFestival
                  ? { lastCount: increment(matchedLine.qty), lastCountAt: serverTimestamp() }
                  : { incomingQty: increment(matchedLine.qty) }
                ),
                ...(uid ? { lastCountBy: uid } : {}),
                updatedAt: serverTimestamp(),
              });
              stockUpdates++;
            }
          });
        }
      }

      if (stockUpdates > 0) await stockBatch.commit();
    } catch (e: any) {
      console.warn('[creditNotes] stock reversal failed:', e?.message);
    }

    return { ok: true, invoiceId: invRef.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not save credit note' };
  }
}
