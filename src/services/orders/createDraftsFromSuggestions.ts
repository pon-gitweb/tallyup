import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc,
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine, CompatBucket } from './suggest';

type CreateOpts = {
  createdBy?: string | null;
};

function isUnassignedKey(k: string): boolean {
  return (
    k === 'unassigned' ||
    k === '__no_supplier__' ||
    k === 'no_supplier' ||
    k === 'none' ||
    k === 'null' ||
    k === 'undefined' ||
    k === ''
  );
}

function extractLines(bucket: CompatBucket | any): SuggestedLine[] {
  if (!bucket || typeof bucket !== 'object') return [];
  if (Array.isArray(bucket.lines)) return bucket.lines as SuggestedLine[];
  if (bucket.items && typeof bucket.items === 'object') return Object.values(bucket.items as Record<string, SuggestedLine>);
  // Fallback: derive from own keys
  const out: SuggestedLine[] = [];
  for (const k of Object.keys(bucket)) {
    const v = (bucket as any)[k];
    if (v && typeof v === 'object' && 'productId' in v) out.push(v as SuggestedLine);
  }
  return out;
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: CreateOpts = {}
): Promise<{ created: string[] }> {
  const db = getFirestore(getApp());
  const created: string[] = [];

  for (const supplierKey of Object.keys(suggestions)) {
    const bucket = suggestions[supplierKey];
    const lines = extractLines(bucket);
    if (!lines.length) continue;

    const supplierId = isUnassignedKey(supplierKey) ? null : supplierKey;
    const needsSupplierReview = isUnassignedKey(supplierKey) || lines.some((l) => !!l.needsSupplier);

    // Order header
    const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
      status: 'draft',
      supplierId: supplierId ?? null,
      createdAt: serverTimestamp(),
      createdBy: opts.createdBy ?? null,
      source: 'suggestions',
      needsSupplierReview,
    });

    // Lines
    const batch = writeBatch(db);
    for (const line of lines) {
      const pid = line.productId || crypto.randomUUID?.() || Math.random().toString(36).slice(2);
      const unitCost = Number.isFinite(line.cost as any) ? Number(line.cost) : 0;
      batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', pid), {
        productId: line.productId ?? null,
        name: line.productName ?? null,
        qty: Number(line.qty) || 0,
        unitCost,
        needsPar: !!line.needsPar,
        needsSupplier: !!line.needsSupplier,
        reason: line.reason ?? null,
      });
    }
    await batch.commit();

    created.push(orderRef.id);
  }

  return { created };
}
