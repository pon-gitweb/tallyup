import { getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

function toLines(bucket: any): SuggestedLine[] {
  if (!bucket) return [];
  if (Array.isArray(bucket.lines)) return bucket.lines as SuggestedLine[];
  const items = bucket.items && typeof bucket.items === 'object' ? bucket.items : bucket;
  const out: SuggestedLine[] = [];
  for (const k of Object.keys(items || {})) {
    if (k === 'items' || k === 'lines') continue;
    const v = (items as any)[k];
    if (v && typeof v === 'object' && 'productId' in v) out.push(v as SuggestedLine);
  }
  return out;
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string|null } = {}
): Promise<{ created: string[] }> {
  const db = getFirestore(getApp());
  const created: string[] = [];
  for (const supplierKey of Object.keys(suggestions || {})) {
    const bucket = suggestions[supplierKey];
    const lines = toLines(bucket);
    if (!lines.length) continue;

    const isUnassigned =
      supplierKey === 'unassigned' || supplierKey === '__no_supplier__' ||
      supplierKey === 'null' || supplierKey === '' || supplierKey === 'undefined' || supplierKey === 'none';

    const supplierId = isUnassigned ? null : supplierKey;

    const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
      status: 'draft',
      supplierId: supplierId ?? null,
      createdAt: serverTimestamp(),
      createdBy: opts.createdBy ?? null,
      source: 'suggestions',
      needsSupplierReview: isUnassigned ? true : false,
    });

    const batch = writeBatch(db);
    for (const l of lines) {
      const unitCost = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', l.productId), {
        productId: l.productId,
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
