// @ts-nocheck
/**
 * Finalizers for CSV/PDF/MANUAL flows.
 * - Calls REST reconcile-invoice
 * - Saves reconciliation bundle id
 * - Marks order as invoiced (was: received)
 * - Updates item lastCount for each received line
 * - Creates an invoice document for the delivery
 */
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, updateDoc, serverTimestamp,
  collection, getDocs, getDoc, addDoc, increment, writeBatch, Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { reconcileInvoiceREST } from '../invoices/reconcile';
import { saveReconciliation } from '../invoices/reconciliationStore';

type Parsed = {
  invoice?: { source?: 'csv'|'pdf'|'manual'|string; storagePath?: string; poNumber?: string|null } | null;
  lines?: Array<{ code?:string; name:string; qty:number; unitPrice?:number }>;
  matchReport?: any;
  confidence?: number | null;
  warnings?: string[] | null;
};

async function updateStockAndCreateInvoice(
  db: any,
  venueId: string,
  orderId: string,
  uid: string | null,
): Promise<string[]> {
  const warnings: string[] = [];

  // Read order header + lines
  const orderSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
  if (!orderSnap.exists()) return warnings;
  const orderData = orderSnap.data() as any;

  const linesSnap = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
  const orderLines: Array<{ productId:string; name:string; qty:number; unitCost:number }> = [];
  linesSnap.forEach(d => {
    const x = d.data() as any;
    orderLines.push({
      productId: String(x.productId || d.id),
      name: String(x.name || x.productName || ''),
      qty: Number(x.qty || 0),
      unitCost: Number(x.unitCost || x.cost || 0),
    });
  });

  if (orderLines.length === 0) return warnings;

  // Find matching area items across all departments and update stock
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

          const matchedLine = orderLines.find(l =>
            (l.productId && itemProductId && l.productId === itemProductId) ||
            (l.name && itemName && l.name.toLowerCase().trim() === itemName),
          );
          if (matchedLine && matchedLine.qty > 0) {
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

    if (stockUpdates > 0) {
      try {
        await stockBatch.commit();
        console.log('[receive] stock updated for', stockUpdates, 'item(s)');
      } catch (e: any) {
        console.error('[receive] stock batch commit failed:', e?.message);
        warnings.push(`Stock counts could not be updated: ${e?.message || 'permission denied'}`);
      }
    }
  } catch (e: any) {
    console.error('[receive] stock update failed:', e?.message);
    warnings.push(`Stock update failed: ${e?.message || 'unknown error'}`);
  }

  // Create invoice document for this delivery
  try {
    const now = Timestamp.now();
    const totalAmount = orderLines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const invoiceDoc: Record<string, any> = {
      supplierId: orderData.supplierId || null,
      supplierName: orderData.supplierName || null,
      orderId,
      poNumber: orderData.poNumber || null,
      invoiceDate: now,
      invoiceDateTimestamp: now,
      date: now,
      status: 'posted',
      source: 'order-receive',
      totalAmount,
      totals: { subtotal: totalAmount },
      venueId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(uid ? { createdBy: uid } : {}),
    };
    const invRef = await addDoc(collection(db, 'venues', venueId, 'invoices'), invoiceDoc);

    // Write invoice lines
    const lineBatch = writeBatch(db);
    for (const l of orderLines) {
      const lineRef = doc(collection(db, 'venues', venueId, 'invoices', invRef.id, 'lines'), l.productId);
      lineBatch.set(lineRef, {
        productId: l.productId,
        productName: l.name,
        name: l.name,
        qty: l.qty,
        unitCost: l.unitCost,
        cost: l.unitCost,
        lineTotal: l.qty * l.unitCost,
      });
    }
    await lineBatch.commit();
    console.log('[receive] invoice created:', invRef.id);
  } catch (e: any) {
    console.error('[receive] invoice creation failed:', e?.message);
    warnings.push(`Invoice creation failed: ${e?.message || 'unknown error'}`);
  }

  return warnings;
}

async function finalizeReceiveCore(kind:'csv'|'pdf'|'manual', args: { venueId:string; orderId:string; parsed: Parsed }) {
  const { venueId, orderId, parsed } = args;
  const db = getFirestore(getApp());
  const uid = getAuth()?.currentUser?.uid || null;

  // 0) Duplicate receive protection — bail if already invoiced/received
  try {
    const orderSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
    if (orderSnap.exists()) {
      const currentStatus = (orderSnap.data() as any)?.status;
      if (currentStatus === 'invoiced' || currentStatus === 'received') {
        return { ok: false, error: `Order already ${currentStatus} — cannot receive again` };
      }
    }
  } catch (e: any) {
    console.warn('[receive] duplicate check failed (continuing):', e?.message);
  }

  // 1) Reconcile on server (authoritative)
  const reconciled = await reconcileInvoiceREST(venueId, orderId, {
    invoice: {
      source: kind,
      storagePath: parsed?.invoice?.storagePath || '',
      poNumber: parsed?.invoice?.poNumber ?? null,
      confidence: parsed?.confidence ?? null,
      warnings: parsed?.warnings ?? []
    },
    lines: parsed?.lines || [],
    matchReport: parsed?.matchReport,
    confidence: parsed?.confidence ?? null,
    warnings: parsed?.warnings ?? []
  });

  if (!reconciled?.ok) {
    return { ok:false, error: reconciled?.error || 'reconcile failed' };
  }

  // 2) Persist reconciliation summary bundle (id used on order)
  const saved = await saveReconciliation(venueId, orderId, reconciled);

  // 3) Update stock counts + create invoice document
  const stockWarnings = await updateStockAndCreateInvoice(db, venueId, orderId, uid);

  // 4) Mark invoiced (fully received + invoice created)
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'invoiced',
    receivedAt: serverTimestamp(),
    invoicedAt: serverTimestamp(),
    lastReconciliationId: saved?.id || reconciled?.reconciliationId || null
  });

  return {
    ok: true,
    reconciliationId: saved?.id || reconciled?.reconciliationId || null,
    ...(stockWarnings.length > 0 ? { stockUpdateWarnings: stockWarnings } : {}),
  };
}

export async function finalizeReceiveFromCsv(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('csv', args);
}
export async function finalizeReceiveFromPdf(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('pdf', args);
}
export async function finalizeReceiveFromManual(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('manual', args);
}
