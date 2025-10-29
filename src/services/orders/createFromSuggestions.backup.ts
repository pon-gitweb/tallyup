// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, serverTimestamp,
  writeBatch, doc, getDocs, where, query,
  runTransaction, getDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { SuggestedLegacyMap, SuggestedLine } from './suggest';

type Scope = 'ALL' | { type:'DEPT', name:string };

function computeSuggestionKey(
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

function deriveDesiredScope(lines: any[]): Scope {
  const depts = Array.from(
    new Set((Array.isArray(lines) ? lines : [])
      .map(l => (l && typeof l === 'object' ? (l as any).dept : null))
      .filter(Boolean)
      .map(String))
  );
  if (depts.length === 1) return { type:'DEPT', name: String(depts[0]) };
  if (depts.length === 0) return 'ALL';
  return 'ALL'; // multiple depts → treat as ALL header with multi-dept content
}

function supplierKeyOrUnassigned(supplierId: string | null): string {
  const s = (supplierId && supplierId.trim()) || '';
  return s.length ? s : 'unassigned';
}

// Manager permission check for creating ALL-scope orders
async function isManagerOrAbove(db: ReturnType<typeof getFirestore>): Promise<boolean> {
  const uid = getAuth(getApp()).currentUser?.uid;
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'users', uid));
  const role = (snap.exists() ? (snap.data() as any)?.role : null) || 'basic';
  return ['owner','admin','manager'].includes(String(role).toLowerCase());
}

// Transactional supplier precedence lock
// - If no lock: set to desired scope (ALL or first DEPT).
// - If locked ALL: block DEPT.
// - If locked DEPT: block ALL; allow additional DEPTs (accumulate).
async function ensureSupplierLockOrBlock(
  venueId: string,
  supplierId: string | null,
  desired: Scope
): Promise<null | 'ALL_EXISTS' | 'DEPT_EXISTS'> {
  const db = getFirestore(getApp());
  const lockRef = doc(db, 'venues', venueId, 'orders_locks', supplierKeyOrUnassigned(supplierId));
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(lockRef);
    if (!snap.exists()) {
      if (desired === 'ALL') {
        tx.set(lockRef, { mode: 'ALL', depts: [], updatedAt: serverTimestamp() });
      } else {
        tx.set(lockRef, { mode: 'DEPT', depts: [desired.name], updatedAt: serverTimestamp() });
      }
      return null;
    }
    const data: any = snap.data() || {};
    const mode = data.mode;
    const depts: string[] = Array.isArray(data.depts) ? data.depts.map(String) : [];

    if (mode === 'ALL') {
      if (desired !== 'ALL') return 'ALL_EXISTS';
      return null; // desired ALL and lock ALL → idempotent
    }

    // mode === 'DEPT'
    if (desired === 'ALL') {
      return 'DEPT_EXISTS';
    }
    if (!depts.includes(desired.name)) {
      tx.update(lockRef, { depts: [...depts, desired.name], updatedAt: serverTimestamp() });
    } else {
      tx.update(lockRef, { updatedAt: serverTimestamp() });
    }
    return null;
  });
}

export async function createDraftsFromSuggestions(
  venueId: string,
  suggestions: SuggestedLegacyMap,
  opts: { createdBy?: string | null } = {}
): Promise<{ created: string[]; blockedReason?: 'ALL_EXISTS'|'DEPT_EXISTS'|'NEED_MANAGER' }> {
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
    const desired = deriveDesiredScope(lines);

    // Manager-only gate for ALL
    if (desired === 'ALL') {
      const ok = await isManagerOrAbove(db);
      if (!ok) {
        console.warn('[Orders] Blocked: NEED_MANAGER for ALL', { supplierId });
        return { created, blockedReason: 'NEED_MANAGER' };
      }
    }

    // Transactional precedence guard (authoritative)
    const block = await ensureSupplierLockOrBlock(venueId, supplierId, desired);
    if (block) {
      console.warn('[Orders] Blocked by supplier lock', { block, supplierId, desired });
      return { created, blockedReason: block };
    }

    // Dedupe by key for this supplier (still helpful)
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

    // Create order header
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
      ...(desired !== 'ALL' ? { deptScope: [desired.name] } : {}),
    });

    // Lines
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

    console.log('[Orders] Draft created (tx-locked)', { id: orderRef.id, suggestionKey, desired });
    created.push(orderRef.id);
  }

  return { created };
}
