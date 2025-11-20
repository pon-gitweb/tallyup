// @ts-nocheck
/**
 * adoptGlobalCatalogToVenue.ts
 *
 * One-tap adoption of a global supplier's catalog into a venue's Products collection.
 * - Ensures a venue-level supplier exists (reuses if name matches, otherwise creates).
 * - For each global catalog item:
 *   • If a product with the same name exists, updates supplier + price/pack metadata.
 *   • Otherwise, creates a new product linked to that supplier.
 *
 * This is designed as a "safe default":
 *   - We never delete products.
 *   - We only update a focused set of fields (supplier, packaging, prices, GST).
 */

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { listSupplierItems } from './globalCatalog';
import { listSuppliers, createSupplier } from '../suppliers';

export type AdoptSummary = {
  created: number;
  updated: number;
  skipped: number;
  supplierId: string;
  supplierName: string;
};

function cleanName(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function adoptGlobalCatalogToVenue(args: {
  venueId: string;
  globalSupplierId: string;
}): Promise<AdoptSummary> {
  const { venueId, globalSupplierId } = args;
  if (!venueId || !globalSupplierId) {
    throw new Error('adoptGlobalCatalogToVenue: venueId and globalSupplierId required');
  }

  // 1) Read global supplier doc for a display name
  const supRef = doc(db, 'global_suppliers', globalSupplierId);
  const supSnap = await getDoc(supRef);
  const supData = supSnap.exists() ? (supSnap.data() as any) : null;
  const displayName: string = cleanName(supData?.name || globalSupplierId) || globalSupplierId;

  // 2) Ensure a venue-level supplier exists (de-dupe on name, case-insensitive)
  const venueSuppliers = await listSuppliers(venueId);
  let venueSupplierId: string | undefined;
  let venueSupplierName: string = displayName;

  const existing = venueSuppliers.find(
    (s) => cleanName(s.name).toLowerCase() === displayName.toLowerCase()
  );

  if (existing?.id) {
    venueSupplierId = existing.id;
    venueSupplierName = existing.name || displayName;
  } else {
    // Brand new supplier for this venue
    venueSupplierId = await createSupplier(venueId, { name: displayName } as any);
  }

  if (!venueSupplierId) {
    throw new Error('adoptGlobalCatalogToVenue: failed to resolve or create venue supplier');
  }

  // 3) Load all global catalog items for this supplier
  const items = await listSupplierItems(globalSupplierId);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const it of items) {
    const name = cleanName((it as any)?.name);
    if (!name) {
      skipped++;
      continue;
    }

    // Compute a per-unit cost if possible
    const priceBottle = typeof (it as any).priceBottleExGst === 'number'
      ? (it as any).priceBottleExGst
      : null;
    const priceCase = typeof (it as any).priceCaseExGst === 'number'
      ? (it as any).priceCaseExGst
      : null;
    const unitsPerCase = typeof (it as any).unitsPerCase === 'number'
      ? (it as any).unitsPerCase
      : null;

    let unitPrice: number | null = null;
    if (priceBottle != null) {
      unitPrice = priceBottle;
    } else if (priceCase != null && unitsPerCase && unitsPerCase > 0) {
      unitPrice = priceCase / unitsPerCase;
    }

    const gstPercent =
      typeof (it as any).gstPercent === 'number' ? (it as any).gstPercent : 15;

    // 4) Look for an existing product in this venue with the same name.
    //    We deliberately only filter on name (single-field index) and then
    //    refine in-memory if needed, to avoid composite-index churn.
    const qRef = query(
      collection(db, 'venues', venueId, 'products'),
      where('name', '==', name)
    );
    const snap = await getDocs(qRef);
    const docs = snap.docs;

    if (docs.length > 0) {
      // Update the first product we find with this name.
      const existingDoc = docs[0];
      const prefRef = doc(db, 'venues', venueId, 'products', existingDoc.id);

      const updatePayload: Record<string, any> = {
        supplierId: venueSupplierId,
        supplierName: venueSupplierName,
        supplier: { id: venueSupplierId, name: venueSupplierName },
        updatedAt: serverTimestamp(),
      };

      if ((it as any).unit) updatePayload.unit = (it as any).unit;
      if ((it as any).size) updatePayload.size = (it as any).size;
      if (unitsPerCase != null) updatePayload.packSize = unitsPerCase;
      if (unitPrice != null) {
        updatePayload.costPrice = unitPrice;
        updatePayload.lastSupplierPrice = unitPrice;
        updatePayload.lastSupplierPriceUpdatedAt = serverTimestamp();
      }
      updatePayload.gstPercent = gstPercent;

      await updateDoc(prefRef, updatePayload);
      updated++;
      continue;
    }

    // 5) No existing product → create a new one
    try {
      await addDoc(collection(db, 'venues', venueId, 'products'), {
        name,
        unit: (it as any).unit ?? null,
        size: (it as any).size ?? null,
        packSize: unitsPerCase,
        abv: typeof (it as any).abv === 'number' ? (it as any).abv : null,
        costPrice: unitPrice,
        gstPercent,
        supplierId: venueSupplierId,
        supplierName: venueSupplierName,
        supplier: { id: venueSupplierId, name: venueSupplierName },
        active: true,
        // light provenance
        source: 'globalCatalog',
        globalSupplierId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created++;
    } catch (e) {
      if (__DEV__) {
        console.log('[adoptGlobalCatalogToVenue] create failed for', { venueId, name, e });
      }
      skipped++;
    }
  }

  if (__DEV__) {
    console.log('[adoptGlobalCatalogToVenue] done', {
      venueId,
      globalSupplierId,
      created,
      updated,
      skipped,
      supplierId: venueSupplierId,
      supplierName: venueSupplierName,
    });
  }

  return {
    created,
    updated,
    skipped,
    supplierId: venueSupplierId,
    supplierName: venueSupplierName,
  };
}
