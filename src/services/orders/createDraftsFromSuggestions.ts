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

  const supplierKeys = Object.keys(suggestions || {});
  for (const supplierKey of supplierKeys) {
    const bucket: any = (suggestions as any)[supplierKey] || {};
    const items: Record<string, SuggestedLine> =
      (bucket.items && typeof bucket.items === 'object') ? bucket.items : bucket;

    const entries = Object.entries(items).filter(([k]) => k !== 'items' && k !== 'lines');
    if (entries.length === 0) continue;

    const isUnassigned =
      supplierKey === 'unassigned' ||
      supplierKey === '__no_supplier__' ||
      supplierKey === 'no_supplier' ||
      supplierKey === 'none' ||
      supplierKey === 'null' ||
      supplierKey === '' ||
      supplierKey === 'undefined';

    const supplierId = isUnassigned ? null : supplierKey;

    // Create order
    const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
      status: 'draft',
      supplierId: supplierId ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: 'suggestions',
      needsSupplierReview: isUnassigned ? true : false,
    });

    // Lines
    const batch = writeBatch(db);
    for (const [productId, line] of entries) {
      const l = line as SuggestedLine;
      const unitCost = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', productId), {
        productId,
        name: (l as any).productName ?? null,
        qty: Number((l as any).qty) || 0,
        unitCost,
        needsPar: !!(l as any).needsPar,
        needsSupplier: !!(l as any).needsSupplier,
        reason: (l as any).reason ?? null,
      });
    }
    await batch.commit();
    created.push(orderRef.id);
  }

  return { created };
}
