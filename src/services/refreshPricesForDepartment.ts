import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { buildProductMaps, resolveProduct } from './products/resolveProduct';

/**
 * Dual-pass price refresh for a single department at cycle-reset time.
 * Shared by startNewDepartmentCycle (cycles.ts / festival mode) and the
 * two production reset paths in reset.ts (resetDepartment and
 * resetAllDepartmentsStockTake).
 *
 * Pass 1 — Item price sync: fetches every item in the department, walks each
 *   item's productId through resolveProduct()'s mergedInto chain, and overwrites
 *   the item's costPrice where it diverges from the resolved product's canonical
 *   value. Writes previousCostPrice / costPriceRefreshedAt /
 *   costPriceSource:'cycle_reset' as flat fields; no per-item history
 *   subcollection (earlier design decision). Items with no productId, or whose
 *   productId resolves to nothing (missing doc, inactive with no forward
 *   pointer), are silently skipped and not counted in either return bucket.
 *
 * Pass 2 — Physical-count basis correction: aggregates each resolved product's
 *   item.lastCount values across the whole department and writes
 *   costPriceQuantityBasis / quantityConfidence:'physical_count' /
 *   costPriceBasisAt to the product document. costPrice is intentionally NOT
 *   written here — only the WAC engine (invoked at invoice-commit time) owns
 *   that field.
 *
 * ORDERING CONTRACT: callers must await any confirmedCount-restoration batch
 *   before calling this function, so Pass 2 reads the post-restoration
 *   lastCount values rather than stale pre-reset counts.
 *
 * Cross-department limitation: Pass 2 only sees this department's items.
 *   A product that spans multiple departments will have its
 *   costPriceQuantityBasis overwritten by whichever department's reset runs
 *   last — a known limitation that would require a venue-wide simultaneous
 *   pass to fix correctly.
 *
 * Returns itemsPriceRefreshed (items updated) and itemsAlreadyCurrent (items
 *   whose price already matched their product, no write needed).
 */
export async function refreshPricesForDepartment(
  venueId: string,
  departmentId: string,
): Promise<{ itemsPriceRefreshed: number; itemsAlreadyCurrent: number }> {
  // Fetch all venue products once — shared by both passes.
  const prodSnap = await getDocs(collection(db, `venues/${venueId}/products`));
  const { prodById } = buildProductMaps(prodSnap);

  const areasSnap = await getDocs(
    collection(db, `venues/${venueId}/departments/${departmentId}/areas`),
  );

  let itemsPriceRefreshed = 0;
  let itemsAlreadyCurrent = 0;
  // Accumulates item.lastCount per resolved product ID for Pass 2.
  const lastCountByProduct: Record<string, number> = {};

  // ── Pass 1: item price sync ───────────────────────────────────────────────
  for (const areaDoc of areasSnap.docs) {
    const itemsSnap = await getDocs(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas/${areaDoc.id}/items`),
    );
    const itemBatch = writeBatch(db);
    let hasBatch = false;

    itemsSnap.forEach(itemDoc => {
      const item = itemDoc.data() as any;
      const update: Record<string, any> = {};

      const productId: string | undefined = item.productId;
      if (productId) {
        const resolved = resolveProduct(productId, prodById);
        if (resolved) {
          // Price sync: overwrite item.costPrice when it diverges from the
          // resolved product's canonical value.
          const productCostPrice = resolved.entry.costPrice;
          if (typeof productCostPrice === 'number') {
            const itemCostPrice: number | undefined =
              typeof item.costPrice === 'number' ? item.costPrice : undefined;
            if (itemCostPrice !== productCostPrice) {
              update.previousCostPrice = itemCostPrice ?? null;
              update.costPrice = productCostPrice;
              update.costPriceRefreshedAt = serverTimestamp();
              update.costPriceSource = 'cycle_reset';
              itemsPriceRefreshed++;
            } else {
              itemsAlreadyCurrent++;
            }
          }

          // Accumulate lastCount for the physical-count basis write.
          const lastCount = typeof item.lastCount === 'number' ? item.lastCount : 0;
          lastCountByProduct[resolved.id] = (lastCountByProduct[resolved.id] ?? 0) + lastCount;
        }
      }

      if (Object.keys(update).length > 0) {
        itemBatch.update(itemDoc.ref, update);
        hasBatch = true;
      }
    });

    if (hasBatch) await itemBatch.commit();
  }

  // ── Pass 2: physical-count basis correction ───────────────────────────────
  // costPrice is intentionally absent — see doc-comment above.
  if (Object.keys(lastCountByProduct).length > 0) {
    const basisBatch = writeBatch(db);
    for (const [productId, qty] of Object.entries(lastCountByProduct)) {
      basisBatch.update(doc(db, `venues/${venueId}/products/${productId}`), {
        costPriceQuantityBasis: qty,
        quantityConfidence: 'physical_count',
        costPriceBasisAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await basisBatch.commit();
  }

  return { itemsPriceRefreshed, itemsAlreadyCurrent };
}
