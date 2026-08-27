import { collection, doc, getDocs, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { ensureDeptSessionActive } from './activeDeptTake';
import { buildProductMaps, resolveProduct } from './products/resolveProduct';

/**
 * Start a new stock-take cycle for a department.
 *
 * Beyond the original area/item reset this now performs two additional passes:
 *
 * Pass 1 — Item price refresh: for every item whose resolved product has a
 *   different costPrice, the item's own costPrice is overwritten in the same
 *   batched write that zeros incomingQty/soldQty. Writes previousCostPrice,
 *   costPriceRefreshedAt, and costPriceSource:'cycle_reset' as flat fields —
 *   no per-item history subcollection (matching the earlier design decision).
 *
 * Pass 2 — Product quantity-basis correction: aggregates each resolved
 *   product's lastCount values across all items in this department and writes
 *   costPriceQuantityBasis / quantityConfidence:'physical_count' /
 *   costPriceBasisAt to the product document. costPrice is intentionally
 *   NOT touched here — only the WAC engine (invoked at invoice-commit time)
 *   changes the canonical cost.
 *
 * Cross-department aggregation limitation: Pass 2 sums lastCount across this
 *   department only. A product that spans multiple departments will have its
 *   costPriceQuantityBasis overwritten by whichever department's cycle-reset
 *   runs last. Correcting this would require a venue-wide cycle-reset pass
 *   that iterates all departments simultaneously before writing any product
 *   basis — a meaningful refactor deferred to a later phase.
 *
 * Returns itemsPriceRefreshed (items whose costPrice was stale) and
 * itemsAlreadyCurrent (items whose price already matched their product).
 * Items with no productId or a missing/inactive-with-no-chain product are
 * silently skipped and not counted in either bucket.
 */
export async function startNewDepartmentCycle(
  venueId: string,
  departmentId: string,
): Promise<{ itemsPriceRefreshed: number; itemsAlreadyCurrent: number }> {
  const areasCol = collection(db, `venues/${venueId}/departments/${departmentId}/areas`);
  const snap = await getDocs(areasCol);
  const now = serverTimestamp();

  // ── Area-level reset (unchanged) ─────────────────────────────────────────────
  for (const a of snap.docs) {
    const areaRef = doc(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}`);
    await setDoc(
      areaRef,
      { startedAt: null, completedAt: null, cycleResetAt: now, lastConfirmedAt: now },
      { merge: true },
    );
  }

  // ── Fetch all venue products once (shared by both passes below) ───────────────
  const prodSnap = await getDocs(collection(db, `venues/${venueId}/products`));
  const { prodById } = buildProductMaps(prodSnap);

  let itemsPriceRefreshed = 0;
  let itemsAlreadyCurrent = 0;

  // Accumulates lastCount per resolved product ID for Pass 2.
  const lastCountByProduct: Record<string, number> = {};

  // ── Pass 1: zero incomingQty/soldQty + refresh item-level costPrice ───────────
  for (const a of snap.docs) {
    const itemsSnap = await getDocs(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas/${a.id}/items`),
    );
    const itemBatch = writeBatch(db);
    let hasBatch = false;

    itemsSnap.forEach(itemDoc => {
      const item = itemDoc.data() as any;
      const update: Record<string, any> = { incomingQty: 0, soldQty: 0 };

      const productId: string | undefined = item.productId;
      if (productId) {
        const resolved = resolveProduct(productId, prodById);
        if (resolved) {
          // Item price refresh: sync item's costPrice to the product's canonical value.
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

          // Accumulate lastCount for the product-level basis write.
          const lastCount = typeof item.lastCount === 'number' ? item.lastCount : 0;
          lastCountByProduct[resolved.id] = (lastCountByProduct[resolved.id] ?? 0) + lastCount;
        }
      }

      itemBatch.update(itemDoc.ref, update);
      hasBatch = true;
    });

    if (hasBatch) await itemBatch.commit();
  }

  // ── Pass 2: write physical-count quantity basis to each resolved product ───────
  // costPrice is intentionally absent from this write — see doc-comment above.
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

  // ── Department-level reset (unchanged) ────────────────────────────────────────
  await setDoc(
    doc(db, `venues/${venueId}/departments/${departmentId}`),
    { completedAt: null, cycleResetAt: now },
    { merge: true },
  );

  await ensureDeptSessionActive(venueId, departmentId);

  return { itemsPriceRefreshed, itemsAlreadyCurrent };
}

/**
 * Start a new stock-take cycle for ALL ACTIVE departments in a venue.
 * Departments with active=false are skipped.
 */
export async function startNewVenueCycle(venueId: string) {
  const depts = await getDocs(collection(db, `venues/${venueId}/departments`));
  for (const d of depts.docs) {
    const data = d.data() as any;
    const active = typeof data?.active === 'boolean' ? data.active : true;
    if (!active) continue;
    await startNewDepartmentCycle(venueId, d.id);
  }
  // Reset or mark venue session as active
  await setDoc(doc(db, `venues/${venueId}/sessions/current`), {
    status: 'active',
    restartedAt: serverTimestamp(),
  }, { merge: true });
}
