import { db } from './firebase';
import { collection, getDocs } from 'firebase/firestore';
import { listProducts } from './products';

/**
 * Scans the venue's departments → areas → items, and aggregates on‑hand by product.
 * Assumptions:
 *  - Items live at: venues/{venueId}/departments/{depId}/areas/{areaId}/items/{itemId}
 *  - Each item has `lastCount` (number), optional `productId`, optional `sku`.
 *  - Products may have `sku` to enable fallback mapping when productId is missing.
 *
 * Returns: Record<productId, onHandTotal>
 */
export async function getOnHandByProduct(venueId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  // Build a SKU → productId map for fallback matching.
  const products = await listProducts(venueId);
  const skuToPid: Record<string, string> = {};
  for (const p of products) {
    const pid = (p as any).id as string | undefined;
    const sku = (p as any).sku as string | undefined;
    if (pid && sku) skuToPid[sku.trim().toLowerCase()] = pid;
  }

  // Get departments
  const depSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const depDoc of depSnap.docs) {
    const depId = depDoc.id;

    // Get areas under each department
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
    for (const areaDoc of areasSnap.docs) {
      const areaId = areaDoc.id;

      // Get items under each area
      const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas', areaId, 'items'));
      for (const it of itemsSnap.docs) {
        const data = it.data() as any;
        const countRaw = data?.lastCount;
        const count = typeof countRaw === 'number' ? countRaw : Number(countRaw) || 0;
        if (!(count > 0)) continue;

        // Prefer explicit productId
        let pid: string | undefined = data?.productId;
        if (!pid) {
          const sku = (data?.sku && String(data.sku).trim().toLowerCase()) || '';
          if (sku && skuToPid[sku]) pid = skuToPid[sku];
        }
        if (!pid) continue; // cannot map this item to a product

        out[pid] = (out[pid] || 0) + count;
      }
    }
  }

  return out;
}
