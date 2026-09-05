import * as admin from "firebase-admin";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

// ─── Price-change cascade to recipe COGS ──────────────────────────────────────
//
// Fires whenever a venue product's costPrice changes. Recalculates costPerServe
// for every recipe ingredient linked to that product (matched by productId, or
// by matchedProductName for ingredients that carry one but no live link), then
// recomputes each affected recipe's cogs/estimatedGpPct. Non-fatal to the rest
// of the app — every failure is caught and logged, never thrown outward.
//
// GP alert cascade (second pass, same trigger):
// When the price change also clears the ≥5% bar used by flagPriceChangeToManager,
// and the venue has gpAlertSensitivity set, a persisted notice is written to
// venues/{venueId}/gpAlerts/{autoId} for every recipe whose ingredient cost
// delta per serve exceeds the sensitivity threshold. Each recipe gets its own
// record, never a conflated one.

// ─── Private helpers ──────────────────────────────────────────────────────────

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

// ─── Exported pure helpers (used by the trigger; exported for unit tests) ─────

/** Maps a venue's gpAlertSensitivity preset to an ingredient-cost-delta-per-serve
 *  threshold in dollars. Returns null when alerts are disabled ('off').
 *
 *  These thresholds are an internal implementation detail — the preset names
 *  ("small", "moderate", etc.) are what the user sees; never expose these numbers.
 *
 *  null/absent sensitivity is treated as 'moderate' (same default as the UI).
 */
export function gpAlertDollarThreshold(
  sensitivity: string | null | undefined,
): number | null {
  switch (sensitivity) {
    case "off":         return null;   // disabled — no alerts
    case "significant": return 1.00;   // only major cost shifts
    case "small":       return 0.05;   // catch any detectable shift
    case "moderate":
    default:            return 0.20;   // recommended default; also covers null/absent
  }
}

/** GP% for a recipe, using the same formula as priceCascade's existing recompute.
 *  rrp and cogs are ex-GST recipe-level values (not the same as product sellPrice).
 *  Returns null when rrp is absent or zero. */
export function computeRecipeGpPct(rrp: number | null, cogs: number): number | null {
  if (rrp == null || rrp <= 0) return null;
  return round2(((rrp - cogs) / rrp) * 100);
}

/** The per-recipe impact captured during the cascade for GP alert evaluation. */
export interface RecipeImpact {
  recipeId: string;
  recipeName: string;
  /** Total recipe cogs before this ingredient price change. */
  oldCogs: number;
  /** Total recipe cogs after this ingredient price change. */
  newCogs: number;
  /** Recipe GP% before (null if no rrp). */
  oldGpPct: number | null;
  /** Recipe GP% after (null if no rrp). */
  newGpPct: number | null;
}

/** Shape of a gpAlert document (sans Firestore-only fields like createdAt). */
export interface GpAlertDoc {
  recipeId: string;
  recipeName: string;
  ingredientProductId: string;
  ingredientProductName: string;
  oldCostPrice: number;
  newCostPrice: number;
  changePercent: number;
  oldGpPct: number | null;
  newGpPct: number | null;
  dismissed: false;
  dismissedBy: null;
  dismissedAt: null;
}

/** Pure function: filter recipe impacts by dollar threshold and shape into
 *  gpAlert payloads. One record per recipe — never a conflated record.
 *
 *  The materiality gate is the ingredient cost delta per serve (|newCogs - oldCogs|)
 *  vs the dollar threshold derived from gpAlertSensitivity. This incorporates
 *  the GP% shift (higher-value ingredients produce larger absolute cogs swings)
 *  without requiring sales velocity data we may not have.
 */
export function buildGpAlertDocs(
  touchedRecipes: RecipeImpact[],
  threshold: number,
  ingredientProductId: string,
  ingredientProductName: string,
  oldCostPrice: number,
  newCostPrice: number,
  changePercent: number,
): GpAlertDoc[] {
  return touchedRecipes
    .filter((r) => Math.abs(r.newCogs - r.oldCogs) >= threshold)
    .map((r) => ({
      recipeId: r.recipeId,
      recipeName: r.recipeName,
      ingredientProductId,
      ingredientProductName,
      oldCostPrice,
      newCostPrice,
      changePercent: round2(changePercent),
      oldGpPct: r.oldGpPct,
      newGpPct: r.newGpPct,
      dismissed: false as const,
      dismissedBy: null,
      dismissedAt: null,
    }));
}

// ─── Firestore trigger ────────────────────────────────────────────────────────

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

      // Collect per-recipe impact data for the GP alert pass below.
      const touchedRecipes: RecipeImpact[] = [];

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

        // Capture before/after cogs for the GP alert pass.
        // oldCogs from original items (before this update); newCogs from updatedItems.
        const oldCogs = round2(items.reduce((sum: number, it: any) => sum + deriveCost(it), 0));
        const newCogsRaw = updatedItems.reduce((sum: number, it: any) => sum + deriveCost(it), 0);
        const rrp = typeof recipe.rrp === "number" ? recipe.rrp : null;
        const estimatedGpPct = computeRecipeGpPct(rrp, newCogsRaw);

        batch.update(recipeDoc.ref, {
          items: updatedItems,
          cogs: round2(newCogsRaw),
          estimatedGpPct,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        recipesAffected++;

        touchedRecipes.push({
          recipeId: recipeDoc.id,
          recipeName: typeof recipe.name === "string" ? recipe.name : recipeDoc.id,
          oldCogs,
          newCogs: round2(newCogsRaw),
          // oldGpPct from the stored value (accurate unless the recipe has never been costed)
          oldGpPct: typeof recipe.estimatedGpPct === "number" ? recipe.estimatedGpPct : computeRecipeGpPct(rrp, oldCogs),
          newGpPct: estimatedGpPct,
        });
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

      // ── GP alert cascade ─────────────────────────────────────────────────────
      // Only runs when the price change clears the same ≥5% bar as the invoice
      // flag (flagPriceChangeToManager). Changes below 5% don't merit GP alerts.
      // Best-effort — failures are caught and logged; the main cascade has already
      // committed, so this never blocks or unwinds the recipe cogs update above.
      try {
        if (oldCostPrice == null || oldCostPrice <= 0) return;
        const absChangePercent = Math.abs((newCostPrice - oldCostPrice) / oldCostPrice) * 100;
        if (absChangePercent < 5) return; // below the materiality trigger

        const venueSnap = await db.doc(`venues/${venueId}`).get();
        const sensitivity = (venueSnap.data() as any)?.gpAlertSensitivity ?? null;
        const threshold = gpAlertDollarThreshold(sensitivity);
        if (threshold === null) return; // alerts disabled for this venue

        const alertDocs = buildGpAlertDocs(
          touchedRecipes,
          threshold,
          productId,
          productName,
          oldCostPrice,
          newCostPrice,
          absChangePercent,
        );
        if (alertDocs.length === 0) return;

        const alertBatch = db.batch();
        for (const doc of alertDocs) {
          const ref = db.collection(`venues/${venueId}/gpAlerts`).doc();
          alertBatch.set(ref, {
            ...doc,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await alertBatch.commit();

        console.log("[onProductPriceChanged] gpAlerts", {
          venueId, productId, alertCount: alertDocs.length,
        });
      } catch (gpErr: any) {
        console.error("[onProductPriceChanged] gpAlerts ERROR (non-fatal)", gpErr?.message || gpErr);
      }
    } catch (e: any) {
      console.error("[onProductPriceChanged] ERROR", e?.message || e);
    }
  }
);
