// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp,
  writeBatch, doc, getDocs, where, query
} from 'firebase/firestore';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

/**
 * Canonical suggestion key used across app.
 * "<supplierId||unassigned>|productId:qty,productId:qty" (sorted)
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

/** ---- Scope helpers (ALL precedence) ---- */
type Scope = 'ALL' | { type:'DEPT', name:string };

function normalizeScope(raw:any): Scope {
  if (!raw) return 'ALL';
  if (raw === 'ALL') return 'ALL';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return 'ALL';
    if (raw.length === 1) return { type:'DEPT', name:String(raw[0]) };
    return 'ALL';
  }
  return 'ALL';
}

async function fetchExistingDraftScopes(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  supplierId: string | null
): Promise<Scope[]> {
  const col = collection(db, 'venues', venueId, 'orders');
  const qref = supplierId
    ? query(col, where('status','==','draft'), where('source','==','suggestions'), where('supplierId','==', supplierId))
    : query(col, where('status','==','draft'), where('source','==','suggestions'));
  const snap = await getDocs(qref);
  const out: Scope[] = [];
  snap.forEach(d => {
    const v:any = d.data() || {};
    out.push(normalizeScope(v?.deptScope));
  });
  return out;
}
/** ---- /Scope helpers ---- */

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[]; blockedReason?: 'ALL_EXISTS'|'DEPT_EXISTS' }> {
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

    const safeQty = (q: any) => Math.max(1, Math.round(Number(q) || 1));
    const linesCount = lines.length;
    const total = lines.reduce((sum, l) => {
      const qty = safeQty((l as any).qty);
      const unit = Number.isFinite((l as any).cost) ? Number((l as any).cost) : 0;
      return sum + qty * unit;
    }, 0);

    const suggestionKey = computeSuggestionKey(supplierId, lines);

    // Query possible existing drafts for this supplier (for dedupe by key)
    const ordersCol = collection(db, 'venues', venueId, 'orders');
    const qRefForKey = supplierId
      ? query(ordersCol, where('status','==','draft'), where('source','==','suggestions'), where('supplierId','==', supplierId))
      : query(ordersCol, where('status','==','draft'), where('source','==','suggestions'));
    const snapForKey = await getDocs(qRefForKey);
    let existingId: string | null = null;
    snapForKey.forEach(d => {
      const data: any = d.data() || {};
      if (data?.suggestionKey === suggestionKey) existingId = d.id;
    });
    if (existingId) {
      console.log('[Orders] Draft exists', { id: existingId, suggestionKey });
      created.push(existingId);
      continue;
    }

    // Derive desired dept scope from incoming lines
    const deptScope = Array.from(
      new Set(
        (lines as any[]).map(l => (l && typeof l === 'object' ? (l as any).dept : null))
          .filter(Boolean)
          .map(String)
      )
    );
    const deptScopeField = deptScope.length ? deptScope : null;

    // ---- SCOPE PRECEDENCE GUARD (authoritative) ----
    const desiredScope = normalizeScope(deptScopeField);
    const existingScopes = await fetchExistingDraftScopes(db, venueId, supplierId ?? null);
    const hasExistingALL = existingScopes.some(s => s === 'ALL');
    const hasExistingAnyDept = existingScopes.some(s => s !== 'ALL');

    if (desiredScope === 'ALL' && hasExistingAnyDept) {
      console.warn('[Orders] Blocked ALL draft: department drafts already exist for this supplier.');
      return { created, blockedReason: 'DEPT_EXISTS' };
    }
    if (desiredScope !== 'ALL' && hasExistingALL) {
      console.warn('[Orders] Blocked Dept draft: an ALL draft already exists for this supplier.');
      return { created, blockedReason: 'ALL_EXISTS' };
    }
    // ---- /SCOPE PRECEDENCE GUARD ----

    const orderRef = await addDoc(ordersCol, {
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
        dept: (l as any).dept ?? null,
      }, { merge: true });
    }
    await batch.commit();

    console.log('[Orders] Draft created', { id: orderRef.id, suggestionKey });
    created.push(orderRef.id);
  }

  return { created };
}
