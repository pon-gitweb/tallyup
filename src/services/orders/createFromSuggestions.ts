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
      return pid ? `${pid}:${qtyNum}` : '';
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

const getDeptTag = (l: any): string | null =>
  (l?.dept ?? l?.deptKey ?? l?.department ?? null) ? String(l.dept ?? l.deptKey ?? l.department) : null;

const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

type ScopeInfo = {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestedLine[];
  deptScope: string[]; // unique truthy dept tags (empty => treat as ALL)
  isUnassigned: boolean;
  suggestionKey: string;
};

/** Find an existing ALL-scope draft for this supplier in this venue. */
async function findExistingAllDraft(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  supplierId: string | null
): Promise<{ id: string; deptScope?: any } | null> {
  const col = collection(db, 'venues', venueId, 'orders');

  // We cannot OR on "deptScope == 'ALL' OR missing" in one query without composite/array hacking,
  // so do a cheap pass: query drafts for this supplier (or all drafts for unassigned)
  const qRef = supplierId
    ? query(col, where('status', '==', 'draft'), where('supplierId', '==', supplierId), where('source', '==', 'suggestions'))
    : query(col, where('status', '==', 'draft'), where('source', '==', 'suggestions'));

  const snap = await getDocs(qRef);
  for (const d of snap.docs) {
    const v: any = d.data() || {};
    const scope = v?.deptScope ?? 'ALL';
    // Treat missing or 'ALL' or array with >1 depts as "ALL/merged"
    const isMergedArray = Array.isArray(scope) && scope.length > 1;
    if (!scope || scope === 'ALL' || isMergedArray) return { id: d.id, deptScope: scope };
  }
  return null;
}

/**
 * Decide if this group should be treated as ALL/merged:
 * - If deptScope has >1 unique depts => merged (ALL-like)
 * - If deptScope is empty (no tags) => treat as ALL-like
 */
function isAllLike(scope: string[]): boolean {
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.length > 1;
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[] }> {
  const db = getFirestore(getApp());
  const created: string[] = [];

  // Build normalized entries
  const entries: ScopeInfo[] = [];
  for (const supplierKey of Object.keys(suggestions || {})) {
    const bucket = suggestions[supplierKey];
    const lines = toLines(bucket);
    if (!lines.length) continue;

    const isUnassigned =
      supplierKey === 'unassigned' ||
      supplierKey === '__no_supplier__' ||
      supplierKey === 'null' ||
      supplierKey === '' ||
      supplierKey === 'undefined' ||
      supplierKey === 'none';

    const supplierId: string | null = isUnassigned ? null : supplierKey;
    const supplierName: string | null = (bucket?.supplierName && String(bucket.supplierName)) || null;

    const deptScope = unique(
      (lines as any[])
        .map(getDeptTag)
        .filter(Boolean) as string[]
    );

    const suggestionKey = computeSuggestionKey(supplierId, lines);

    entries.push({ supplierId, supplierName, lines, deptScope, isUnassigned, suggestionKey });
  }

  // Determine which suppliers must MERGE (ALL precedence) this run
  const suppliersNeedingMerge = new Set<string | null>();
  for (const e of entries) {
    if (isAllLike(e.deptScope)) suppliersNeedingMerge.add(e.supplierId); // null allowed for unassigned
  }

  // Also: if an existing ALL draft already exists for a supplier, mark it to prevent per-dept drafts.
  const existingAllCache = new Map<string | null, boolean>();
  for (const sid of Array.from(new Set(entries.map(e => e.supplierId)))) {
    const existsAll = await findExistingAllDraft(db, venueId, sid);
    if (existsAll) existingAllCache.set(sid, true);
  }

  // Now create drafts with precedence:
  // - If supplier is in suppliersNeedingMerge OR has an existing ALL draft -> only create one merged draft
  // - Otherwise create per-scope drafts (single-dept buckets)
  // We’ll loop suppliers => then their entries.
  const bySupplier = new Map<string | null, ScopeInfo[]>();
  for (const e of entries) {
    const key = e.supplierId ?? null;
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(e);
  }

  const ordersCol = collection(db, 'venues', venueId, 'orders');

  for (const [sid, list] of bySupplier.entries()) {
    const hasExistingAll = existingAllCache.get(sid) === true;
    const mustMerge = suppliersNeedingMerge.has(sid) || hasExistingAll;

    if (mustMerge) {
      // Pick the first entry (any) and collapse all lines for this supplier
      const allLines: SuggestedLine[] = [];
      for (const e of list) allLines.push(...e.lines);

      // Dedupe by productId; sum qty
      const mergedByPid: Record<string, SuggestedLine> = {};
      for (const l of allLines as any[]) {
        const pid = String(l.productId);
        const qty = Math.max(1, Math.round(Number(l.qty) || 1));
        if (!mergedByPid[pid]) mergedByPid[pid] = { ...(l as any), qty };
        else mergedByPid[pid].qty += qty;
      }
      const mergedLines = Object.values(mergedByPid);

      // Dept scope for the merged order: union of all tags; empty => treat as ALL
      const mergedScope = unique(
        (mergedLines as any[]).map(getDeptTag).filter(Boolean) as string[]
      );
      const deptScopeField: any = mergedScope.length ? mergedScope : 'ALL';

      const supplierName =
        list.find(e => e.supplierName)?.supplierName ?? null;

      // DEDUPE by suggestionKey
      const mergedKey = computeSuggestionKey(sid, mergedLines);
      // Query drafts for this supplier (or all suggestion-drafts for unassigned)
      const qRef = sid
        ? query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', sid))
        : query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'));
      const snap = await getDocs(qRef);
      let existingId: string | null = null;
      snap.forEach(d => {
        const data: any = d.data() || {};
        if (data?.suggestionKey === mergedKey) existingId = d.id;
      });
      if (existingId) {
        console.log('[Orders] Draft exists (ALL precedence)', { id: existingId, suggestionKey: mergedKey });
        created.push(existingId);
        continue;
      }

      // Create single merged draft
      const linesCount = mergedLines.length;
      const total = mergedLines.reduce((sum, l: any) => {
        const qty = Math.max(1, Math.round(Number(l?.qty) || 1));
        const unit = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        return sum + qty * unit;
      }, 0);

      const orderRef = await addDoc(ordersCol, {
        deptScope: deptScopeField,                  // 'ALL' or string[]
        displayStatus: 'draft',
        supplierId: sid ?? null,
        supplierName: supplierName ?? null,
        source: 'suggestions',
        suggestionKey: mergedKey,
        needsSupplierReview: !sid ? true : false,
        createdAt: serverTimestamp(),
        createdAtClientMs: Date.now(),
        linesCount,
        total,
        createdBy: opts.createdBy ?? null,
      });

      const batch = writeBatch(db);
      for (const l of mergedLines as any[]) {
        const unitCost = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        batch.set(
          doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', String(l.productId)),
          {
            productId: l.productId,
            name: l.productName ?? null,
            qty: Math.max(1, Math.round(Number(l?.qty) || 1)),
            unitCost,
            packSize: Number.isFinite(l?.packSize) ? Number(l.packSize) : null,
            needsPar: !!l?.needsPar,
            needsSupplier: !!l?.needsSupplier,
            reason: l?.reason ?? null,
            dept: getDeptTag(l),
          },
          { merge: true }
        );
      }
      await batch.commit();

      console.log('[Orders] Draft created (ALL precedence)', { id: orderRef.id, suggestionKey: mergedKey });
      created.push(orderRef.id);
      // IMPORTANT: skip any per-dept drafts for this supplier (ALL precedence).
      continue;
    }

    // No merge needed: create per-entry drafts (each entry is single-dept scope)
    for (const e of list) {
      const sidLocal = e.supplierId;
      const supplierName = e.supplierName ?? null;
      const deptScopeField: any = e.deptScope.length ? e.deptScope : 'ALL';

      // DEDUPE by suggestionKey
      const qRef = sidLocal
        ? query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', sidLocal))
        : query(ordersCol, where('status', '==', 'draft'), where('source', '==', 'suggestions'));
      const snap = await getDocs(qRef);
      let existingId: string | null = null;
      snap.forEach(d => {
        const data: any = d.data() || {};
        if (data?.suggestionKey === e.suggestionKey) existingId = d.id;
      });
      if (existingId) {
        console.log('[Orders] Draft exists', { id: existingId, suggestionKey: e.suggestionKey });
        created.push(existingId);
        continue;
      }

      const linesCount = e.lines.length;
      const total = e.lines.reduce((sum, l: any) => {
        const qty = Math.max(1, Math.round(Number(l?.qty) || 1));
        const unit = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        return sum + qty * unit;
      }, 0);

      const orderRef = await addDoc(ordersCol, {
        deptScope: deptScopeField,                  // single string[] or 'ALL'
        displayStatus: 'draft',
        supplierId: sidLocal ?? null,
        supplierName: supplierName ?? null,
        source: 'suggestions',
        suggestionKey: e.suggestionKey,
        needsSupplierReview: !sidLocal ? true : false,
        createdAt: serverTimestamp(),
        createdAtClientMs: Date.now(),
        linesCount,
        total,
        createdBy: opts.createdBy ?? null,
      });

      const batch = writeBatch(db);
      for (const l of e.lines as any[]) {
        const unitCost = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        batch.set(
          doc(db, 'venues', venueId, 'orders', orderRef.id, 'lines', String(l.productId)),
          {
            productId: l.productId,
            name: l.productName ?? null,
            qty: Math.max(1, Math.round(Number(l?.qty) || 1)),
            unitCost,
            packSize: Number.isFinite(l?.packSize) ? Number(l.packSize) : null,
            needsPar: !!l?.needsPar,
            needsSupplier: !!l?.needsSupplier,
            reason: l?.reason ?? null,
            dept: getDeptTag(l),
          },
          { merge: true }
        );
      }
      await batch.commit();

      console.log('[Orders] Draft created', { id: orderRef.id, suggestionKey: e.suggestionKey });
      created.push(orderRef.id);
    }
  }

  return { created };
}
