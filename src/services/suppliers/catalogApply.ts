// @ts-nocheck
/**
 * Apply supplier links to products using existing writers.
 * Also writes lastSupplierPrice if a numeric price is supplied for the row.
 * Note: In unit test env (no Firebase app), price write is skipped gracefully.
 */
import { ensureProduct } from '../orders/linking';
import { setSupplierOnProduct } from '../orders/suppliers';
import type { Firestore } from 'firebase/firestore';
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export type ApplyRow = {
  rowIndex: number;
  productId?: string | null;
  productName?: string | null;
  supplierId: string;
  supplierName?: string | null;
  createIfMissing?: boolean;
  price?: number | null;       // optional numeric price from CSV
};

export type ApplyReportItem = {
  rowIndex: number;
  status: 'ok' | 'skipped' | 'error';
  productId?: string | null;
  message?: string;
};

export async function applyCatalogLinks(params: {
  venueId: string;
  rows: ApplyRow[];
  db?: Firestore | null; // optional injection for tests
}): Promise<{ results: ApplyReportItem[] }> {
  const { venueId, rows } = params || {};
  let { db } = params || {};
  const results: ApplyReportItem[] = [];

  if (!venueId || !Array.isArray(rows) || rows.length === 0) {
    return { results };
  }

  // Try to obtain a Firestore instance; if none (e.g. unit tests), we skip price write
  if (!db) {
    try { db = getFirestore(); } catch { db = null; }
  }

  for (const r of rows) {
    const rowIndex = Number(r.rowIndex ?? -1);
    try {
      if (!r?.supplierId) {
        results.push({ rowIndex, status: 'skipped', message: 'Missing supplierId' });
        continue;
      }
      if (!r?.productId && !r?.productName) {
        results.push({ rowIndex, status: 'skipped', message: 'No productId or productName provided' });
        continue;
      }

      // Optionally ensure product exists (safe if already there)
      if (r.productId && r.createIfMissing) {
        await ensureProduct(venueId, r.productId, r.productName ?? r.productId);
      }

      let finalProductId = r.productId ?? null;
      if (!finalProductId && r.productName) {
        const seed = String(r.productName).trim();
        if (!seed) {
          results.push({ rowIndex, status: 'skipped', message: 'Cannot derive productId from empty name' });
          continue;
        }
        finalProductId = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await ensureProduct(venueId, finalProductId, r.productName);
      }

      if (!finalProductId) {
        results.push({ rowIndex, status: 'skipped', message: 'No productId available after ensure step' });
        continue;
      }

      // Link supplier to product (always)
      await setSupplierOnProduct(venueId, finalProductId, r.supplierId, r.supplierName ?? undefined);

      // Optionally persist lastSupplierPrice (numeric only, and only if db available)
      if (db && Number.isFinite(r?.price)) {
        const ref = doc(db, 'venues', venueId, 'products', finalProductId);
        await updateDoc(ref, {
          lastSupplierPrice: Number(r.price),
          updatedAt: serverTimestamp(),
        });
      }

      results.push({ rowIndex, status: 'ok', productId: finalProductId });
    } catch (e:any) {
      results.push({ rowIndex, status: 'error', message: e?.message || 'Unknown error' });
    }
  }

  return { results };
}
