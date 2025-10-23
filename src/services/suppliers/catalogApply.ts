// @ts-nocheck
/**
 * Apply supplier links to products using existing writers.
 * No schema changes. Safe to call from any UI.
 */
import { ensureProduct } from '../orders/linking';
import { setSupplierOnProduct } from '../orders/suppliers';

export type ApplyRow = {
  rowIndex: number;              // index from preview
  productId?: string | null;     // chosen product (existing or to be created)
  productName?: string | null;   // optional: name when creating new
  supplierId: string;            // the supplier we’re linking to
  supplierName?: string | null;  // display name (optional; util will resolve name if omitted)
  createIfMissing?: boolean;     // create product if productId is supplied but doesn't exist (by ensureProduct)
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
}): Promise<{ results: ApplyReportItem[] }> {
  const { venueId, rows } = params || {};
  const results: ApplyReportItem[] = [];

  if (!venueId || !Array.isArray(rows) || rows.length === 0) {
    return { results };
  }

  for (const r of rows) {
    const rowIndex = Number(r.rowIndex ?? -1);
    try {
      // Minimal validation
      if (!r?.supplierId) {
        results.push({ rowIndex, status: 'skipped', message: 'Missing supplierId' });
        continue;
      }
      if (!r?.productId && !r?.productName) {
        results.push({ rowIndex, status: 'skipped', message: 'No productId or productName provided' });
        continue;
      }

      // Optionally ensure product exists (safe no-op if it already exists)
      if (r.productId && r.createIfMissing) {
        await ensureProduct(venueId, r.productId, r.productName ?? r.productId);
      }

      // If productId is still missing but we have a name, generate a simple id (callers may replace with a real id strategy)
      let finalProductId = r.productId ?? null;
      if (!finalProductId && r.productName) {
        // Caller chose to create a new product using its name as id seed
        const seed = String(r.productName).trim();
        if (!seed) {
          results.push({ rowIndex, status: 'skipped', message: 'Cannot derive productId from empty name' });
          continue;
        }
        // Simple id suggestion (can be replaced by caller)
        finalProductId = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await ensureProduct(venueId, finalProductId, r.productName);
      }

      if (!finalProductId) {
        results.push({ rowIndex, status: 'skipped', message: 'No productId available after ensure step' });
        continue;
      }

      // Link supplier to product
      await setSupplierOnProduct(venueId, finalProductId, r.supplierId, r.supplierName ?? undefined);

      results.push({ rowIndex, status: 'ok', productId: finalProductId });
    } catch (e:any) {
      results.push({ rowIndex, status: 'error', message: e?.message || 'Unknown error' });
    }
  }

  return { results };
}
