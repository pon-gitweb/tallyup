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
 * Canonical suggestion key:
 * "<supplierId||unassigned>|productId:roundedQty[,productId:roundedQty...]"
 */
export function computeSuggestionKey(
  supplierId: string | null | undefined,
  lines: Array<{ productId: string; qty: number | null | undefined }>
): string {
  const sid = supplierId && String(supplierId).trim().length ? String(supplierId).trim() : 'unassigned';
  const parts = (Array.isArray(lines) ? lines : [])
    .map(l => {
      const pid = String((l as any)?.productId || '');
      if (!pid) return '';
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

const getDeptTag = (l: any): string | null =>
  (l?.dept ?? l?.deptKey ?? l?.department ?? null)
    ? String(l.dept ?? l.deptKey ?? l.department)
    : null;

const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

type ScopeInfo = {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestedLine[];
  deptScope: string[]; // unique truthy tags; empty => treat as ALL-like
  isUnassigned: boolean;
  suggestionKey: string;
};

type ExistingFlags = {
  hasAllDraft: boolean;          // an ALL/merged draft already exists
  hasPerDeptDraft: boolean;      // at least one single-dept draft already exists
};

/** Helper: fetch all "suggestion drafts" for a supplier using displayStatus=='draft'. */
async function fetchDraftSuggestionDocs(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  supplierId: string | null
) {
  const ordersCol = collection(db, 'venues', venueId, 'orders');
  const qRef = supplierId
    ? query(ordersCol, where('displayStatus', '==', 'draft'), where('source', '==', 'suggestions'), where('supplierId', '==', supplierId))
    : query(ordersCol, where('displayStatus', '==', 'draft'), where('source', '==', 'suggestions'));
  return getDocs(qRef);
}

/** Fetch existing suggestion drafts for a supplier (or all for unassigned) and classify. */
async function scanExistingDrafts(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  supplierId: string | null
): Promise<ExistingFlags> {
  const snap = await fetchDraftSuggestionDocs(db, venueId, supplierId);

  let hasAllDraft = false;
  let hasPerDeptDraft = false;

  snap.forEach(d => {
    const v: any = d.data() || {};
    const scope = v?.deptScope ?? 'ALL';
    // Missing or 'ALL' or array with >1 depts → treat as merged “ALL”
    const isMergedArray = Array.isArray(scope) && scope.length > 1;
    if (!scope || scope === 'ALL' || isMergedArray) {
      hasAllDraft = true;
    } else if (Array.isArray(scope) && scope.length === 1) {
      hasPerDeptDraft = true;
    }
  });

  return { hasAllDraft, hasPerDeptDraft };
}

/** True if this incoming group should be treated as merged “ALL”-like. */
function isAllLike(scope: string[]): boolean {
  if (!Array.isArray(scope) || scope.length === 0) return true; // no tags => ALL-like
  return scope.length > 1;
}

// ---- Scope helpers (ALL precedence) ----
function normalizeScope(raw:any): 'ALL' | {type:'DEPT', name:string} {
  // Accept shapes: null/undefined -> ALL, 'ALL' string, [] -> ALL, ['bar'] -> DEPT, ['bar','kitchen'] -> ALL
  if (!raw) return 'ALL';
  if (raw === 'ALL') return 'ALL';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return 'ALL';
    if (raw.length === 1) return { type: 'DEPT', name: String(raw[0]) };
    return 'ALL';
  }
  // any other truthy value that isn't array — treat as ALL for safety
  return 'ALL';
}

async function fetchExistingDraftScopes(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  supplierId: string | null
): Promise<('ALL' | {type:'DEPT', name:string})[]> {
  const col = collection(db, 'venues', venueId, 'orders');
  let qref;
  if (supplierId) {
    qref = query(col, where('status','==','draft'), where('source','==','suggestions'), where('supplierId','==', supplierId));
  } else {
    // unassigned supplier: scan all suggestion drafts; we’ll normalize client-side
    qref = query(col, where('status','==','draft'), where('source','==','suggestions'));
  }
  const snap = await getDocs(qref);
  const out:any[] = [];
  snap.forEach(d => {
    const v:any = d.data() || {};
    out.push(normalizeScope(v?.deptScope));
  });
  return out;
}
// ---- /Scope helpers ----

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[]; skipped?: Array<{ supplierId: string | null; reason: string }> }> {
  const db = getFirestore(getApp());
  const created: string[] = [];
  const skipped: Array<{ supplierId: string | null; reason: string }> = [];

  // Normalize to (supplierId → entries)
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

  // Group by supplier
  const bySupplier = new Map<string | null, ScopeInfo[]>();
  for (const e of entries) {
    const key = e.supplierId ?? null;
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(e);
  }

  const ordersCol = collection(db, 'venues', venueId, 'orders');

  // For each supplier, check existing drafts and then decide creation behavior
  for (const [sid, list] of bySupplier.entries()) {
    const existing = await scanExistingDrafts(db, venueId, sid);

    // If any incoming entry is ALL-like:
    const incomingHasALL = list.some(e => isAllLike(e.deptScope));
    // If any incoming entry is single-dept:
    const incomingHasSingle = list.some(e => Array.isArray(e.deptScope) && e.deptScope.length === 1);

    // Rule A: If an ALL draft already exists for this supplier → block single-dept creation.
    // Rule B: If any per-dept draft(s) already exist for this supplier → block ALL creation.
    // Rule C: Within the same run, prefer creating exactly one merged draft if the incoming set is ALL-like AND no per-dept drafts exist yet.

    if (incomingHasALL) {
      // We want to create ONE merged draft (ALL) — but only if no per-dept drafts already exist.
      if (existing.hasPerDeptDraft) {
        console.log('[Orders] SKIP ALL: blocked_by_existing_per_dept', { supplierId: sid });
        skipped.push({ supplierId: sid ?? null, reason: 'blocked_by_existing_per_dept' });
        continue; // don’t create ALL
      }

      // Merge all lines and create one draft (unless exact-key dedupe hits)
      const allLines: SuggestedLine[] = [];
      for (const e of list) allLines.push(...e.lines);

      // Merge by productId
      const mergedByPid: Record<string, SuggestedLine> = {};
      for (const l of allLines as any[]) {
        const pid = String(l.productId);
        const qty = Math.max(1, Math.round(Number(l.qty) || 1));
        if (!mergedByPid[pid]) mergedByPid[pid] = { ...(l as any), qty };
        else mergedByPid[pid].qty += qty;
      }
      const mergedLines = Object.values(mergedByPid);

      const mergedScope = unique((mergedLines as any[]).map(getDeptTag).filter(Boolean) as string[]);
      const deptScopeField: any = mergedScope.length ? mergedScope : 'ALL';

      // DEDUPE by suggestionKey (use displayStatus == 'draft')
      const mergedKey = computeSuggestionKey(sid, mergedLines);
      {
        const snap = await fetchDraftSuggestionDocs(db, venueId, sid);
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
      }

      const supplierName = list.find(e => e.supplierName)?.supplierName ?? null;
      const linesCount = mergedLines.length;
      const total = mergedLines.reduce((sum, l: any) => {
        const qty = Math.max(1, Math.round(Number(l?.qty) || 1));
        const unit = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        return sum + qty * unit;
      }, 0);

      const orderRef = await addDoc(ordersCol, {
        deptScope: deptScopeField,   // 'ALL' or string[]
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
      continue;
    }

    // Here: NO incoming ALL (each entry should be single-dept)
    for (const e of list) {
      // Block if an ALL draft already exists
      if (existing.hasAllDraft) {
        console.log('[Orders] SKIP single-dept: blocked_by_existing_all', { supplierId: sid });
        skipped.push({ supplierId: sid ?? null, reason: 'blocked_by_existing_all' });
        continue;
      }

      // DEDUPE by suggestionKey (use displayStatus == 'draft')
      {
        const snap = await fetchDraftSuggestionDocs(db, venueId, sid);
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
      }

      const supplierName = e.supplierName ?? null;
      const deptScopeField: any = e.deptScope.length ? e.deptScope : ['UNKNOWN']; // single dept expected
      const linesCount = e.lines.length;
      const total = e.lines.reduce((sum, l: any) => {
        const qty = Math.max(1, Math.round(Number(l?.qty) || 1));
        const unit = Number.isFinite(l?.cost) ? Number(l.cost) : 0;
        return sum + qty * unit;
      }, 0);

      const orderRef = await addDoc(ordersCol, {
        deptScope: deptScopeField,   // single string[] expected
        displayStatus: 'draft',
        supplierId: sid ?? null,
        supplierName: supplierName ?? null,
        source: 'suggestions',
        suggestionKey: e.suggestionKey,
        needsSupplierReview: !sid ? true : false,
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

  return skipped.length ? { created, skipped } : { created };
}
