import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp,
  writeBatch, doc, getDocs, where, query
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

/**
 * Canonical suggestion key used across app.
 * Format: "<supplierId||unassigned>|productId:roundedQty[,productId:roundedQty...]"
 * - productIds sorted asc
 * - qty rounded to integer with a floor of 1 (matches existing UI rounding)
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

/** ---- Dept Merge helper (additive, pure, no side-effects) ---- */
export type DeptMergeDecision = 'MERGE' | 'SEPARATE';

/** Return unique dept tags present on suggestion lines (truthy, stringified). */
export function uniqueDeptsFromLines(lines: Array<any>): string[] {
  return Array.from(
    new Set(
      (Array.isArray(lines) ? lines : [])
        .map(l => (l && typeof l === 'object' ? (l as any).dept : null))
        .filter(Boolean)
        .map(String)
    )
  );
}

/**
 * Decide whether to MERGE or SEPARATE when the same supplier bucket contains multiple depts.
 * - If >1 unique depts => default MERGE (single order header with deptScope including all depts).
 * - If 0 or 1 => SEPARATE is moot (only one), return SEPARATE for clarity.
 * UI can override/ask user later; this only provides a default & the detected depts.
 */
export function decideDeptMergeForSupplier(lines: Array<any>): { decision: DeptMergeDecision; depts: string[] } {
  const depts = uniqueDeptsFromLines(lines);
  if (depts.length > 1) return { decision: 'MERGE', depts };
  return { decision: 'SEPARATE', depts };
}
/** ---- End Dept Merge helper ---- */

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
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

    const supplierId: string | null = isUnassigned ? null : supplierKey;
    const supplierName: string | null = (
      Array.isArray(bucket)
        ? (bucket.find((x:any)=>String(x?.supplierName||'').trim().length>0)?.supplierName ?? null)
        : ((bucket as any)?.supplierName ?? null)
    ) ?? (supplierKey==='unassigned' ? 'Unassigned' : null);

    const safeQty = (q: any) => Math.max(1, Math.round(Number(q) || 1));
    const linesCount = lines.length;
    const total = lines.reduce((sum, l) => {
      const qty = safeQty((l as any).qty);
      const unit = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      return sum + qty * unit;
    }, 0);

    const suggestionKey = computeSuggestionKey(supplierId, lines);

    // --- DEDUPE: check for existing draft with same suggestionKey ---
    const ordersCol = collection(db, 'venues', venueId, 'orders');
    let qRef;
    if (supplierId && supplierId.trim().length > 0) {
      qRef = query(
        ordersCol,
        where('status', '==', 'draft'),
        where('source', '==', 'suggestions'),
        where('supplierId', '==', supplierId)
      );
    } else {
      // For unassigned, query all drafts from suggestions (no supplier filter)
      qRef = query(
        ordersCol,
        where('status', '==', 'draft'),
        where('source', '==', 'suggestions')
      );
    }
    const snap = await getDocs(qRef);
    let existingId: string | null = null;
    snap.forEach(d => {
      const data: any = d.data() || {};
      if (data?.suggestionKey === suggestionKey) {
        existingId = d.id;
      }
    });

    if (existingId) {
      // eslint-disable-next-line no-console
      console.log('[Orders] Draft exists', {
        id: existingId,
        suggestionKey,
      });
      created.push(existingId);
      continue;
    }
    // --- END DEDUPE ---

    // derive deptScope (unique, truthy) from incoming lines if present
    const deptScope = Array.from(
      new Set(
        (lines as any[])
          .map(l => (l && typeof l === 'object' ? (l as any).dept : null))
          .filter(Boolean)
          .map(String)
      )
    );
    const deptScopeField = deptScope.length ? deptScope : null;

    const orderRef = await addDoc(ordersCol, {
      status: 'draft',
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
      // additive: only store if present
      ...(deptScopeField ? { deptScope: deptScopeField } : {}),
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
        // additive: carry through dept if upstream provided it
        dept: (l as any).dept ?? null,
      }, { merge: true });
    }
    await batch.commit();

    // eslint-disable-next-line no-console
    console.log('[Orders] Draft created', {
      id: orderRef.id,
      suggestionKey,
    });

    created.push(orderRef.id);
  }

  return { created };
}
