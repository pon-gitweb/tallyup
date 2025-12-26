// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc,
  getDocs,
  where,
  query,
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

/**
 * Canonical suggestion key used across app.
 * Format: "<supplierId||unassigned>|productId:roundedQty[,productId:roundedQty...]"
 */
export function computeSuggestionKey(
  supplierId: string | null | undefined,
  lines: Array<{ productId: string; qty: number | null | undefined }>
): string {
  const sid = supplierId && String(supplierId).trim().length ? String(supplierId).trim() : 'unassigned';
  const parts = (Array.isArray(lines) ? lines : [])
    .map(l => {
      const pid = String((l as any)?.productId || '');
      const qtyNum = Math.max(1, Math.round(Number((l as any)?.qty) || 1));
      return `${pid}:${qtyNum}`;
    })
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(',');
  return `${sid}|${parts}`;
}

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

function uniqueDeptsFromLines(lines: Array<any>): string[] {
  return Array.from(
    new Set(
      (Array.isArray(lines) ? lines : [])
        .map(l => (l && typeof l === 'object' ? (l as any).dept : null))
        .filter(Boolean)
        .map(String)
    )
  );
}

/** Drafts for a supplier (ANY scope) exist? */
async function anyDraftsForSupplier(db: ReturnType<typeof getFirestore>, venueId: string, supplierId: string | null) {
  const col = collection(db, 'venues', venueId, 'orders');
  const qRef = supplierId
    ? query(col, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', supplierId))
    : query(col, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', null));
  const snap = await getDocs(qRef);
  return !snap.empty;
}

/** There is an existing ALL-scope draft for this supplier? */
async function hasAllDraftForSupplier(db: ReturnType<typeof getFirestore>, venueId: string, supplierId: string | null) {
  const col = collection(db, 'venues', venueId, 'orders');
  const base = supplierId
    ? query(col, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', supplierId))
    : query(col, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', null));
  // We store ALL explicitly as string 'ALL'
  const qRef = query(base, where('deptScope', '==', 'ALL'));
  const snap = await getDocs(qRef);
  return !snap.empty;
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[]; blockedReason?: 'ALL_EXISTS' | 'DEPT_EXISTS' | 'NEED_MANAGER' }> {
  const db = getFirestore(getApp());
  const created: string[] = [];

  for (const supplierKey of Object.keys(suggestions || {})) {
    const bucket = suggestions[supplierKey];
    const lines = toLines(bucket);
    if (!lines.length) continue;

    const isUnassigned =
      supplierKey === 'unassigned' || supplierKey === '__no_supplier__' ||
      supplierKey === 'null' || supplierKey === '' || supplierKey === 'undefined' || supplierKey === 'none';

    const supplierId: string | null = isUnassigned ? null : supplierKey;
    const supplierName: string | null =
      (bucket?.supplierName && String(bucket.supplierName)) || null;

    // Determine scope from incoming lines: one dept => DEPT, otherwise => ALL
    const deptList = uniqueDeptsFromLines(lines);
    const isDeptSpecific = deptList.length === 1;
    const deptScopeField: string | string[] | null = isDeptSpecific ? deptList : 'ALL';

    // --- Supplier-level locking rules ---
    if (deptScopeField === 'ALL') {
      // Creating ALL → block if ANY draft already exists for this supplier (dept or ALL)
      if (await anyDraftsForSupplier(db, venueId, supplierId)) {
        return { created, blockedReason: 'DEPT_EXISTS' };
      }
    } else {
      // Creating DEPT → block if an ALL draft exists for this supplier
      if (await hasAllDraftForSupplier(db, venueId, supplierId)) {
        return { created, blockedReason: 'ALL_EXISTS' };
      }
    }

    // Suggestion-key dedupe (same supplier + same rounded lines)
    const suggestionKey = computeSuggestionKey(supplierId, lines);
    const ordersCol = collection(db, 'venues', venueId, 'orders');
    const qRef = supplierId
      ? query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', supplierId))
      : query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', null));
    const snap = await getDocs(qRef);
    let existingId: string | null = null;
    snap.forEach(d => {
      const data: any = d.data() || {};
      if (data?.suggestionKey === suggestionKey) {
        existingId = d.id;
      }
    });
    if (existingId) {
      console.log('[Orders] Draft exists', { id: existingId, suggestionKey });
      created.push(existingId);
      continue;
    }

    const safeQty = (q: any) => Math.max(1, Math.round(Number(q) || 1));
    const linesCount = lines.length;
    const total = lines.reduce((sum, l) => {
      const qty = safeQty((l as any).qty);
      const unit = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      return sum + qty * unit;
    }, 0);

    const orderRef = await addDoc(ordersCol, {
      deptScope: deptScopeField,                 // 'ALL' | string[]
      displayStatus: 'draft',
      supplierId: supplierId ?? null,
      supplierName: supplierName ?? null,
      source: 'suggestions',
      suggestionKey,
      needsSupplierReview: isUnassigned ? true : false,
      createdAt: serverTimestamp(),
      createdAtClientMs: Date.now(),
      linesCount,
      total,
      createdBy: opts.createdBy ?? null,
    });

    const batch = writeBatch(db);
    for (const l of lines) {
      const unitCost = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      batch.set(doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', String((l as any).productId)), {
        productId: (l as any).productId,
        name: (l as any).productName ?? null,
        qty: safeQty((l as any).qty),
        unitCost,
        packSize: Number.isFinite((l as any).packSize) ? Number((l as any).packSize) : null,
        needsPar: !!(l as any).needsPar,
        needsSupplier: !!(l as any).needsSupplier,
        reason: (l as any).reason ?? null,
        dept: (l as any).dept ?? null,
      }, { merge: true });
    }
    await batch.commit();

    console.log('[Orders] Draft created', {
      id: orderRef.id,
      suggestionKey,
    });

    created.push(orderRef.id);
  }

  return { created };
}
