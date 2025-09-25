import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp, writeBatch, doc
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';
import { findSuggestionsDraftAfter, getLastStocktakeTimeOrWindowStart } from './queries';

type CreateOpts = {
  createdBy?: string | null;
  guard?: boolean;               // default true
  guardWindowHours?: number;     // used only if no stocktake timestamp exists; default 6
};

export type CreateDraftsResult = {
  created: string[];
  skippedByGuard?: boolean;
};

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: CreateOpts = {}
): Promise<CreateDraftsResult> {
  const db = getFirestore(getApp());
  const created: string[] = [];

  const guard = opts.guard !== false;
  if (guard) {
    const since = await getLastStocktakeTimeOrWindowStart(venueId, opts.guardWindowHours ?? 6);
    const exists = await findSuggestionsDraftAfter(venueId, since);
    if (exists) {
      return { created: [], skippedByGuard: true };
    }
  }

  const keys = Object.keys(suggestions);
  for (const supplierKey of keys) {
    const bucket: any = (suggestions as any)[supplierKey] || {};
    // Most-safe way to collect lines across {items},{lines},legacy-root
    const entries: Array<[string, SuggestedLine]> = [];
    if (bucket.items && typeof bucket.items === 'object') {
      for (const [k, v] of Object.entries(bucket.items)) {
        if (v && typeof v === 'object') entries.push([k, v as SuggestedLine]);
      }
    } else {
      for (const [k, v] of Object.entries(bucket)) {
        if (k === 'items' || k === 'lines') continue;
        if (v && typeof v === 'object' && 'productId' in (v as any)) entries.push([k, v as SuggestedLine]);
      }
    }
    if (entries.length === 0) continue;

    const isUnassigned = supplierKey === 'unassigned' || supplierKey === '__no_supplier__' || supplierKey === 'null' || supplierKey === '' || supplierKey === 'undefined' || supplierKey === 'no_supplier' || supplierKey === 'none';
    const supplierId = isUnassigned ? null : supplierKey;

    // Create order
    const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
      status: 'draft',
      supplierId: supplierId ?? null,
      createdAt: serverTimestamp(),
      createdBy: opts.createdBy ?? null,
      source: 'suggestions',
      needsSupplierReview: isUnassigned ? true : false,
    });

    // Lines
    const batch = writeBatch(db);
    for (const [productId, line] of entries) {
      const l = line as SuggestedLine;
      const unitCost = Number.isFinite(l.cost as any) ? Number(l.cost) : 0;
      batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', productId), {
        productId,
        name: l.productName ?? null,
        qty: Number(l.qty) || 0,
        unitCost,
        needsPar: !!l.needsPar,
        needsSupplier: !!l.needsSupplier,
        reason: l.reason ?? null,
      });
    }
    await batch.commit();
    created.push(orderRef.id);
  }

  return { created };
}
