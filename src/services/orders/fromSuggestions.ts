import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp, writeBatch, doc
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

type CreateOpts = {
  createdBy?: string | null;
};

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: CreateOpts = {}
): Promise<{ created: string[] }> {
  const db = getFirestore(getApp());
  const created: string[] = [];

  const keys = Object.keys(suggestions);
  for (const supplierKey of keys) {
    const entries = Object.entries(suggestions[supplierKey] || {});
    if (entries.length === 0) continue;

    const isUnassigned = supplierKey === 'unassigned' || supplierKey === '__no_supplier__' || supplierKey === 'null' || supplierKey === '' || supplierKey === 'undefined';
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
      const l = line as unknown as SuggestedLine;
      const _rawCost:any = (l as any).unitCost ?? (l as any).cost ?? 0;
      const unitCost = Number.isFinite(_rawCost) ? Number(_rawCost) : 0;
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
