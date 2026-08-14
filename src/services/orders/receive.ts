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
  collection, getDocs, getDoc, addDoc, setDoc, increment, writeBatch, Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { reconcileInvoiceREST } from '../invoices/reconcile';
import { saveReconciliation } from '../invoices/reconciliationStore';

type Parsed = {
  invoice?: {
    source?: 'csv'|'pdf'|'manual'|string;
    storagePath?: string;
    poNumber?: string|null;
    invoiceDate?: string|null;
    deliveryDate?: string|null;
  } | null;
  lines?: Array<{ code?:string; name:string; qty:number; unitPrice?:number }>;
  matchReport?: any;
  confidence?: number | null;
  warnings?: string[] | null;
};

// Inline token-overlap matching — mirrors functions/src/nameMatching.ts
// for the client/mobile context (cannot import across the client/server boundary).
function _tokForQty(s: string): Set<string> {
  const words = (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const tokens: string[] = [];
  for (const w of words) {
    const m = w.match(/^([a-z]+)(\d+)$/);
    if (m) { tokens.push(m[1], m[2]); } else { tokens.push(w); }
  }
  return new Set(tokens.map(t => /^\d{2}$/.test(t) ? '20' + t : t));
}
function _overlapQty(a: string, b: string): number {
  const ta = _tokForQty(a), tb = _tokForQty(b);
  if (!ta.size && !tb.size) return 1;
  if (!ta.size || !tb.size) return 0;
  let n = 0; ta.forEach(t => { if (tb.has(t)) n++; });
  return n / Math.min(ta.size, tb.size);
}

async function updateStockAndCreateInvoice(
  db: any,
  venueId: string,
  orderId: string,
  uid: string | null,
  invoiceLines: Array<{name: string; qty: number}>,
): Promise<{ warnings: string[]; unmatchedLines: Array<{name: string; qty: number}> }> {
  const warnings: string[] = [];

  // Read order header + lines
  const orderSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
  if (!orderSnap.exists()) return { warnings, unmatchedLines: [] };
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

  if (orderLines.length === 0) return { warnings, unmatchedLines: [] };

  // For each order line, resolve the effective delivery qty from the invoice.
  // Threshold 0.85 mirrors nameMatching.ts's isReliableMatch score floor.
  // Falls back to ordered qty (+ warning) when no reliable invoice line is found.
  const effectiveQtyMap = new Map<string, number>();
  for (const ol of orderLines) {
    const key = ol.productId || ol.name.toLowerCase();
    if (invoiceLines.length > 0) {
      let bestScore = 0, bestQty = -1;
      for (const il of invoiceLines) {
        const score = _overlapQty(ol.name, il.name);
        if (score >= 0.85 && score > bestScore) { bestScore = score; bestQty = il.qty; }
      }
      if (bestQty >= 0) {
        effectiveQtyMap.set(key, bestQty);
      } else {
        warnings.push(`${ol.name}: no matching invoice line — using ordered quantity (${ol.qty}).`);
        effectiveQtyMap.set(key, ol.qty);
      }
    } else {
      effectiveQtyMap.set(key, ol.qty);
    }
  }

  // Find matching area items across all departments and update stock
  try {
    const venueSnap = await getDoc(doc(db, 'venues', venueId));
    const venueData = venueSnap.data() as any;
    const isFestival = venueData?.venueType === 'festival';
    const stocktakeActive = !isFestival && !!venueData?.stocktakeActive;
    const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
    const matchedProductIds = new Set<string>();
    const stockBatch = writeBatch(db);
    let stockUpdates = 0;

    for (const dep of depsSnap.docs) {
      const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
      for (const area of areasSnap.docs) {
        const itemsSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'),
        );
        for (const itemDoc of itemsSnap.docs) {
          const item = itemDoc.data() as any;
          const itemProductId = String(item.productId || item.productLinkId || '');
          const itemName = (item.name || '').toLowerCase().trim();

          const matchedLine = orderLines.find(l =>
            (l.productId && itemProductId && l.productId === itemProductId) ||
            (l.name && itemName && l.name.toLowerCase().trim() === itemName),
          );
          if (matchedLine) {
            const lineKey = matchedLine.productId || matchedLine.name.toLowerCase();
            matchedProductIds.add(lineKey);
            // Use invoice qty when reliably matched; falls back to order qty (with warning, already logged above)
            const effectiveQty = effectiveQtyMap.get(lineKey) ?? matchedLine.qty;
            if (effectiveQty > 0) {
              if (isFestival) {
                stockBatch.update(itemDoc.ref, {
                  lastCount: increment(effectiveQty),
                  lastCountAt: serverTimestamp(),
                  ...(uid ? { lastCountBy: uid } : {}),
                  updatedAt: serverTimestamp(),
                });
                stockUpdates++;
              } else if (stocktakeActive) {
                // Queue — will be applied to incomingQty on cycle reset
                const pathParts = itemDoc.ref.path.split('/');
                const deptId = pathParts[3];
                const aId = pathParts[5];
                await addDoc(collection(db, 'venues', venueId, 'queuedInvoices'), {
                  itemId: itemDoc.id,
                  departmentId: deptId,
                  areaId: aId,
                  qty: effectiveQty,
                  source: 'invoice',
                  queuedAt: serverTimestamp(),
                });
              } else {
                stockBatch.update(itemDoc.ref, {
                  incomingQty: increment(effectiveQty),
                  ...(uid ? { lastCountBy: uid } : {}),
                  updatedAt: serverTimestamp(),
                });
                stockUpdates++;
              }
            }
          }
        }
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

  const unmatchedLines = orderLines.filter(l =>
    !matchedProductIds.has(l.productId || l.name.toLowerCase())
  ).map(l => ({ name: l.name, qty: l.qty }));

  if (unmatchedLines.length > 0) {
    console.log('[receive] unmatched lines:', unmatchedLines.map(l => l.name));
  }

  // Create invoice document for this delivery
  try {
    const now = Timestamp.now();
    const totalAmount = orderLines.reduce((s, l) => {
      const key = l.productId || l.name.toLowerCase();
      return s + (effectiveQtyMap.get(key) ?? l.qty) * l.unitCost;
    }, 0);
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
      const key = l.productId || l.name.toLowerCase();
      const qty = effectiveQtyMap.get(key) ?? l.qty;
      const lineRef = doc(collection(db, 'venues', venueId, 'invoices', invRef.id, 'lines'), l.productId);
      lineBatch.set(lineRef, {
        productId: l.productId,
        productName: l.name,
        name: l.name,
        qty,
        unitCost: l.unitCost,
        cost: l.unitCost,
        lineTotal: qty * l.unitCost,
      });
    }
    await lineBatch.commit();
    console.log('[receive] invoice created:', invRef.id);
  } catch (e: any) {
    console.error('[receive] invoice creation failed:', e?.message);
    warnings.push(`Invoice creation failed: ${e?.message || 'unknown error'}`);
  }

  return { warnings, unmatchedLines };
}

async function finalizeReceiveCore(kind:'csv'|'pdf'|'manual'|'photo', args: { venueId:string; orderId:string; parsed: Parsed }) {
  const { venueId, orderId, parsed } = args;
  const db = getFirestore(getApp());
  const currentUser = getAuth()?.currentUser || null;
  const uid = currentUser?.uid || null;
  const uidName = currentUser?.displayName || currentUser?.email || null;

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

  // 0b) Invoice-level dedup — prevent same invoice being processed twice
  // Uses PO number (most reliable) or storage path as dedup key
  const invoiceDedupeKey = (() => {
    const po = (parsed?.invoice?.poNumber || '').toString().trim();
    const path = (parsed?.invoice?.storagePath || '').toString().trim();
    if (po && po.length > 2) return `po_${venueId}_${po.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    if (path) return `path_${venueId}_${path.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    return null;
  })();

  if (invoiceDedupeKey) {
    try {
      const dedupRef = doc(db, 'venues', venueId, 'processedInvoices', invoiceDedupeKey);
      const dedupSnap = await getDoc(dedupRef);
      if (dedupSnap.exists()) {
        const existing = dedupSnap.data() as any;
        console.log('[receive] duplicate invoice detected:', invoiceDedupeKey, existing);
        return {
          ok: false,
          error: `This invoice has already been processed${existing.orderId ? ` (Order ${existing.orderId.slice(-6)})` : ''}. If this is a different delivery, ask your supplier for a new PO number.`,
          duplicate: true,
        };
      }
      // Mark as processing immediately to prevent race conditions
      await setDoc(dedupRef, {
        venueId,
        orderId,
        poNumber: parsed?.invoice?.poNumber || null,
        storagePath: parsed?.invoice?.storagePath || null,
        source: parsed?.invoice?.source || 'unknown',
        processedAt: serverTimestamp(),
      });
    } catch (e: any) {
      console.warn('[receive] invoice dedup check failed (continuing):', e?.message);
    }
  }

  // 0c) Invoice date range classification
  let invoicePeriod: 'current' | 'reconciliation' | 'prior' = 'current';
  let periodMessage: string | null = null;

  try {
    const rawDate = parsed?.invoice?.deliveryDate || parsed?.invoice?.invoiceDate;
    if (rawDate) {
      const invoiceDate = new Date(rawDate);
      const now = new Date();
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      if (!isNaN(invoiceDate.getTime()) && invoiceDate <= now && invoiceDate >= twoYearsAgo) {
        const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        let latestConfirmedAt: Date | null = null;
        let latestEditWindowClosesAt: Date | null = null;

        await Promise.all(depsSnap.docs.map(async depDoc => {
          const areasSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', depDoc.id, 'areas')
          );
          areasSnap.forEach(areaDoc => {
            const d = areaDoc.data() as any;
            const lca = d.lastConfirmedAt?.toDate?.() ?? null;
            if (lca && (!latestConfirmedAt || lca > latestConfirmedAt)) latestConfirmedAt = lca;
            const ewc = d.editWindowClosesAt?.toDate?.() ?? null;
            if (ewc && (!latestEditWindowClosesAt || ewc > latestEditWindowClosesAt)) latestEditWindowClosesAt = ewc;
          });
        }));

        if (latestConfirmedAt && invoiceDate < latestConfirmedAt) {
          const reconciliationOpen = latestEditWindowClosesAt && latestEditWindowClosesAt > now;
          if (reconciliationOpen) {
            invoicePeriod = 'reconciliation';
            periodMessage = `This invoice is from your previous stock cycle. It's been applied to update your completed stocktake variance.`;
          } else {
            invoicePeriod = 'prior';
            const cycleDate = (latestConfirmedAt as Date).toLocaleDateString('en-NZ', { dateStyle: 'medium' });
            periodMessage = `This invoice predates your last stocktake (${cycleDate}). It's been recorded for your accounts but won't affect your current stock counts.`;
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[receive] date classification failed (continuing as current):', e?.message);
  }

  if (invoicePeriod === 'prior') {
    try {
      await addDoc(collection(db, 'venues', venueId, 'invoices'), {
        orderId,
        supplierId: null,
        supplierName: null,
        source: parsed?.invoice?.source || 'unknown',
        storagePath: parsed?.invoice?.storagePath || null,
        poNumber: parsed?.invoice?.poNumber || null,
        invoiceDate: parsed?.invoice?.invoiceDate || null,
        status: 'prior-period',
        priorPeriod: true,
        confirmedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(uid ? { createdBy: uid } : {}),
      });
    } catch (e: any) {
      console.warn('[receive] prior period invoice record failed:', e?.message);
    }
    return { ok: true, priorPeriod: true, message: periodMessage };
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
  const { warnings: stockWarnings, unmatchedLines } = await updateStockAndCreateInvoice(db, venueId, orderId, uid, parsed?.lines || []);

  // 4) Mark invoiced (fully received + invoice created)
  await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
    status: 'invoiced',
    receivedAt: serverTimestamp(),
    invoicedAt: serverTimestamp(),
    lastReconciliationId: saved?.id || reconciled?.reconciliationId || null,
    receivedBy: { uid, name: uidName }
  });

  return {
    ok: true,
    reconciliationId: saved?.id || null,
    poMatch: reconciled.poMatch,
    counts: reconciled.counts,
    totals: reconciled.totals,
    anomalies: reconciled.anomalies,
    invoicePeriod,
    periodMessage: periodMessage ?? undefined,
    unmatchedLines: unmatchedLines.length > 0 ? unmatchedLines : undefined,
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
export async function finalizeReceiveFromPhoto(args:{ venueId:string; orderId:string; parsed: Parsed }) {
  return finalizeReceiveCore('photo', args);
}
