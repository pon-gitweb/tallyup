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
  runTransaction,
  arrayUnion,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

const TAG = '[OrdersServiceLocks:v2]';

// ========= Utilities =========
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

// Derive dept scope from lines (exactly one dept → that dept, otherwise 'ALL').
function deriveDeptScope(lines: Array<any>): string | 'ALL' {
  const depts = Array.from(
    new Set(
      (Array.isArray(lines) ? lines : [])
        .map(l => (l && typeof l === 'object' ? (l as any).dept : null))
        .filter(Boolean)
        .map(String)
    )
  );
  return depts.length === 1 ? depts[0] : 'ALL';
}

// ========= Locking model =========
// One lock doc per supplier: venues/{venueId}/orderLocks/{supplierId|null_as_UNASSIGNED}
// Data shape:
//  {
//    mode: 'ALL' | 'DEPTS',
//    depts: string[]            // present when mode==='DEPTS'
//    updatedAt: Timestamp
//  }
//
// Rules:
//  - If mode === 'ALL'  → block any dept create
//  - If mode === 'DEPTS' and depts.length > 0 → block ALL create
//  - Otherwise, allow and set the appropriate lock state
//
// This avoids false negatives/positives from inconsistent data and is atomic.

function lockDocRef(db: ReturnType<typeof getFirestore>, venueId: string, supplierId: string | null) {
  const sid = supplierId ?? '__UNASSIGNED__';
  return doc(db, 'venues', venueId, 'orderLocks', String(sid));
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[]; blockedReason?: 'ALL_EXISTS' | 'DEPT_EXISTS' | 'NEED_MANAGER' }> {
  const db = getFirestore(getApp());
  const created: string[] = [];
  console.log(TAG, 'ENTRY', { venueId });

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

    const deptScopeField: string | 'ALL' = deriveDeptScope(lines);
    const wantAll = deptScopeField === 'ALL';
    const lockRef = lockDocRef(db, venueId, supplierId);

    // --- Transaction for atomic lock + visibility
    const blockedReason = await runTransaction(db, async (tx) => {
      const snap = await tx.get(lockRef);
      const now = serverTimestamp();

      if (!snap.exists()) {
        // No lock yet → establish initial lock for this scope
        if (wantAll) {
          tx.set(lockRef, { mode: 'ALL', depts: [], updatedAt: now });
        } else {
          tx.set(lockRef, { mode: 'DEPTS', depts: [deptScopeField], updatedAt: now });
        }
        return null;
      }

      const data: any = snap.data() || {};
      const mode: 'ALL' | 'DEPTS' = data.mode === 'ALL' ? 'ALL' : 'DEPTS';
      const depts: string[] = Array.isArray(data.depts) ? data.depts.map(String) : [];

      if (wantAll) {
        // Creating ALL: block if any dept already locked
        if (mode === 'DEPTS' && depts.length > 0) return 'DEPT_EXISTS';
        // Otherwise, promote to ALL
        tx.set(lockRef, { mode: 'ALL', depts: [], updatedAt: now }, { merge: true });
        return null;
      } else {
        // Creating a single department draft: block if ALL is already locked
        if (mode === 'ALL') return 'ALL_EXISTS';
        // Otherwise, add this dept to lock set
        const next = new Set(depts);
        next.add(deptScopeField);
        tx.set(lockRef, { mode: 'DEPTS', depts: Array.from(next), updatedAt: now }, { merge: true });
        return null;
      }
    });

    if (blockedReason) {
      console.log(TAG, 'BLOCK', { supplierId, deptScopeField, reason: blockedReason });
      return { created, blockedReason };
    }

    // ========== De-dupe by suggestionKey among current drafts ==========
    const suggestionKey = computeSuggestionKey(supplierId, lines);
    const ordersCol = collection(db, 'venues', venueId, 'orders');
    const qRef = supplierId
      ? query(ordersCol, where('displayStatus', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', supplierId))
      : query(ordersCol, where('displayStatus', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', null));
    const snap = await getDocs(qRef);
    let existingId: string | null = null;
    snap.forEach(d => {
      const data: any = d.data() || {};
      if (data?.suggestionKey === suggestionKey) existingId = d.id;
    });
    if (existingId) {
      console.log('[Orders] Draft exists', { id: existingId, suggestionKey });
      created.push(existingId);
      continue;
    }

    // ========== Create order draft ==========
    const safeQty = (q: any) => Math.max(1, Math.round(Number(q) || 1));
    const linesCount = lines.length;
    const total = lines.reduce((sum, l) => {
      const qty = safeQty((l as any).qty);
      const unit = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      return sum + qty * unit;
    }, 0);

    const orderRef = await addDoc(ordersCol, {
      deptScope: deptScopeField,               // 'ALL' or dept name
      displayStatus: 'draft',
      status: 'draft',                         // keep both for compatibility
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

    console.log('[Orders] Draft created', { id: orderRef.id, suggestionKey, deptScopeField });
    created.push(orderRef.id);
  }

  return { created };
}
