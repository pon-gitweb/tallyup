import * as admin from "firebase-admin";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

// ─── Price-change cascade to recipe COGS ──────────────────────────────────────
//
// Fires whenever a venue product's costPrice changes. Recalculates costPerServe
// for every recipe ingredient linked to that product (matched by productId, or
// by matchedProductName for ingredients that carry one but no live link), then
// recomputes each affected recipe's cogs/estimatedGpPct. Non-fatal to the rest
// of the app — every failure is caught and logged, never thrown outward.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeName(s: any): string {
  return String(s ?? "").toLowerCase().trim();
}

// Fallback cost derivation for items that don't carry an explicit costPerServe —
// mirrors the same (qty / packSize) * packPrice convention used by the client's
// live ingredient editor, so recipe-level cogs totals stay accurate even for
// ingredients this particular price change didn't touch.
function deriveCost(item: any): number {
  const explicit = Number(item?.costPerServe);
  if (Number.isFinite(explicit)) return explicit;
  const qty = Number(item?.qty) || 0;
  const packSize = Number(item?.packSize) > 0 ? Number(item.packSize) : 0;
  const packPrice = Number(item?.packPrice);
  if (packSize > 0 && Number.isFinite(packPrice)) return (qty / packSize) * packPrice;
  return 0;
}

export const onProductPriceChanged = onDocumentUpdated(
  "venues/{venueId}/products/{productId}",
  async (event) => {
    try {
      const beforeSnap = event.data?.before;
      const afterSnap = event.data?.after;
      if (!beforeSnap || !afterSnap) return;

      const before = beforeSnap.data() as any;
      const after = afterSnap.data() as any;
      if (!before || !after) return;

      const oldCostPrice: number | null = typeof before.costPrice === "number" ? before.costPrice : null;
      const newCostPrice: number | null = typeof after.costPrice === "number" ? after.costPrice : null;
      if (oldCostPrice === newCostPrice) return; // unchanged — nothing to cascade
      if (newCostPrice == null) return; // price was cleared, not set — nothing useful to cascade

      const { venueId, productId } = event.params as { venueId: string; productId: string };
      const db = admin.firestore();

      const productName: string = after.name || before.name || "";
      const normalizedProductName = normalizeName(productName);
      const livePackSize: number | null = typeof after.packSize === "number" && after.packSize > 0 ? after.packSize : null;

      const [recipesSnap, productsSnap] = await Promise.all([
        db.collection(`venues/${venueId}/recipes`).limit(400).get(),
        db.collection(`venues/${venueId}/products`).limit(500).get(),
      ]);
      if (recipesSnap.empty) return;

      const liveProductIds = new Set(productsSnap.docs.map((d) => d.id));

      const batch = db.batch();
      let recipesAffected = 0;

      for (const recipeDoc of recipesSnap.docs) {
        const recipe = recipeDoc.data() as any;
        const items: any[] = Array.isArray(recipe.items) ? recipe.items : [];
        if (items.length === 0) continue;

        let touched = false;
        const updatedItems = items.map((item: any) => {
          // Manual overrides are intentional — never touch them.
          if (item?.manualCost === true) return item;

          const linkedProductId: string | null =
            item?.productId && item.productId !== "misc" ? String(item.productId) : null;
          const linkedName = normalizeName(item?.matchedProductName);

          const isThisProduct =
            (linkedProductId && linkedProductId === productId) ||
            (!linkedProductId && linkedName && linkedName === normalizedProductName);

          if (isThisProduct) {
            const qty = Number(item?.qty) || 0;
            const packSize = livePackSize || (Number(item?.packSize) > 0 ? Number(item.packSize) : 1);
            touched = true;
            return {
              ...item,
              costPerServe: round2((qty / packSize) * newCostPrice),
              packPrice: newCostPrice,
              packSize,
              matchedProductName: productName,
              needsRepricing: false,
            };
          }

          // Ingredient still links to a product that no longer exists — flag it,
          // but don't crash and don't touch unlinked/in-house/free-text items.
          if (linkedProductId && !liveProductIds.has(linkedProductId)) {
            if (item?.needsRepricing === true && item?.costPerServe == null) return item; // already flagged
            touched = true;
            return {
              ...item,
              costPerServe: null,
              matchedProductName: null,
              needsRepricing: true,
            };
          }

          return item;
        });

        if (!touched) continue;

        const cogs = updatedItems.reduce((sum: number, it: any) => sum + deriveCost(it), 0);
        const rrp = typeof recipe.rrp === "number" ? recipe.rrp : null;
        const estimatedGpPct = rrp && rrp > 0 ? round2(((rrp - cogs) / rrp) * 100) : null;

        batch.update(recipeDoc.ref, {
          items: updatedItems,
          cogs: round2(cogs),
          estimatedGpPct,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        recipesAffected++;
      }

      if (recipesAffected === 0) return;

      batch.update(afterSnap.ref, {
        lastPriceUpdate: {
          productName,
          oldCostPrice,
          newCostPrice,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          recipesAffected,
        },
      });

      await batch.commit();

      await db.doc(`venues/${venueId}/notifications/${Date.now()}`).set({
        type: "price_cascade",
        productName,
        oldPrice: oldCostPrice,
        newPrice: newCostPrice,
        recipesAffected,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      console.log("[onProductPriceChanged] cascaded", { venueId, productId, productName, recipesAffected });
    } catch (e: any) {
      console.error("[onProductPriceChanged] ERROR", e?.message || e);
    }
  }
);
