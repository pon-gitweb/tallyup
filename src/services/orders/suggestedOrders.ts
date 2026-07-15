import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getVenueSession } from '../completion';

const dlog = (...a: any[]) => console.log('[SuggestedOrders]', ...a);

function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function s(v: any, d = '') {
  return typeof v === 'string' && v.trim().length ? v.trim() : d;
}

export type DeptSnap = { id: string; name: string };
export type SuggestedLine = {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number | null;
  packSize: number | null;
  cost?: number | null;
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
  deptId?: string | null;
  deptName?: string | null;
  qtyDept?: number | null;
  onHandQty?: number;
  usedPar?: number;
  velocityPerDay?: number | null;
  daysOfCover?: number | null;
  coverStatus?: 'critical' | 'low' | 'ok' | 'unknown';
};

/** Re-usable: turn any Firestore timestamp/number/string into YYYYMMDD-HHMMSS (UTC). */
function deriveKeyFromAnyTimestamp(ts: any): string | null {
  if (!ts) return null;
  try {
    let ms: number | null = null;

    if (ts?.toMillis && typeof ts.toMillis === 'function') {
      ms = ts.toMillis();
    } else if (typeof ts === 'number') {
      ms = ts;
    } else if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!Number.isNaN(parsed)) ms = parsed;
    }

    if (!ms || !Number.isFinite(ms)) return null;
    const d = new Date(ms);

    const pad = (x: number, len = 2) => String(x).padStart(len, '0');
    return [
      d.getUTCFullYear(),
      pad(d.getUTCMonth() + 1),
      pad(d.getUTCDate()),
      '-',
      pad(d.getUTCHours()),
      pad(d.getUTCMinutes()),
      pad(d.getUTCSeconds()),
    ].join('');
  } catch {
    return null;
  }
}

/**
 * Decide the stockCycleKey based on the current venue session.
 *
 * Priority:
 *   1) Explicit session.cycleKey (if present) – **always wins**.
 *   2) Fallback: newest timestamp among startedAt/restartedAt/resumedAt/completedAt/finalizedAt.
 */
async function resolveStockCycleKey(venueId: string): Promise<string | null> {
  try {
    const session = await getVenueSession(venueId);
    if (!session) {
      dlog('resolveStockCycleKey: no session');
      return null;
    }

    const status = session.status || null;
    const explicitRaw = (session as any).cycleKey;
    const explicit =
      typeof explicitRaw === 'string' && explicitRaw.trim().length > 0
        ? explicitRaw.trim()
        : null;

    const startedAt = (session as any).startedAt ?? null;
    const restartedAt = (session as any).restartedAt ?? null;
    const resumedAt = (session as any).resumedAt ?? null;
    const completedAt = (session as any).completedAt ?? null;
    const finalizedAt = (session as any).finalizedAt ?? null;

    // 1) Explicit cycleKey always wins if present.
    if (explicit) {
      dlog('resolveStockCycleKey: using explicit cycleKey', {
        status,
        key: explicit,
      });
      return explicit;
    }

    // 2) Fallback: derive from newest timestamp we can see.
    const candidates: any[] = [
      startedAt,
      restartedAt,
      resumedAt,
      completedAt,
      finalizedAt,
    ].filter(Boolean);

    let bestMs = 0;
    let bestTs: any = null;

    const toMs = (ts: any): number => {
      try {
        if (ts?.toMillis && typeof ts.toMillis === 'function') {
          return ts.toMillis();
        }
        if (typeof ts === 'number') return ts;
        if (typeof ts === 'string') {
          const p = Date.parse(ts);
          return Number.isNaN(p) ? 0 : p;
        }
        return 0;
      } catch {
        return 0;
      }
    };

    for (const ts of candidates) {
      const ms = toMs(ts);
      if (ms > bestMs) {
        bestMs = ms;
        bestTs = ts;
      }
    }

    if (bestTs) {
      const key = deriveKeyFromAnyTimestamp(bestTs);
      dlog('resolveStockCycleKey: fallback timestamp-derived key', {
        key,
        status,
      });
      return key;
    }

    dlog('resolveStockCycleKey: no usable timestamp/key', { status });
    return null;
  } catch (e: any) {
    console.warn(
      '[SuggestedOrders] resolveStockCycleKey failed',
      e?.message || e
    );
    return null;
  }
}

export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: { roundToPack?: boolean; defaultParIfMissing?: number } = {
    roundToPack: true,
    defaultParIfMissing: 6,
  }
) {
  const normOpts = {
    roundToPack: !!opts.roundToPack,
    defaultParIfMissing: Number.isFinite(opts.defaultParIfMissing)
      ? Number(opts.defaultParIfMissing)
      : 6,
  };

  dlog('ENTER buildSuggestedOrdersInMemory', { opts: normOpts, venueId });

  const db = getFirestore(getApp());
  const roundToPack = normOpts.roundToPack;
  const defaultPar = normOpts.defaultParIfMissing;

  // ─── Derive stockCycleKey from current venue session ─────────────────────────
  const stockCycleKey = await resolveStockCycleKey(venueId);
  dlog('cycleKey', stockCycleKey || '(none)');

  // Departments
  const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  const departments: DeptSnap[] = depsSnap.docs.map((d) => ({
    id: d.id,
    name: s((d.data() as any)?.name, 'Department'),
  }));

  // Suppliers
  dlog('reading suppliers');
  const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const supplierNameById: Record<string, string> = {};
  suppliersSnap.forEach((d) => {
    supplierNameById[d.id] = s((d.data() as any)?.name, 'Supplier');
  });

  // Products
  dlog('reading products');
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  type ProdMeta = {
    name?: string;
    par?: number | undefined;
    deptPar?: Record<string, number> | undefined;
    supplierId?: string | undefined;
    supplierName?: string | undefined;
    packSize?: number | null;
    cost?: number;
    category?: string;
  };
  const prodMeta: Record<string, ProdMeta> = {};
  productsSnap.forEach((d) => {
    const v: any = d.data() || {};
    const sid = v?.supplierId || v?.supplier?.id || undefined;
    const sname =
      v?.supplierName || v?.supplier?.name || (sid ? supplierNameById[sid] : undefined);
    const deptPar = v?.deptPar && typeof v.deptPar === 'object' ? v.deptPar : undefined;
    prodMeta[d.id] = {
      name: s(v?.name, String(d.id)),
      par: Number.isFinite(v?.par)
        ? Number(v.par)
        : Number.isFinite(v?.parLevel)
        ? Number(v.parLevel)
        : undefined,
      deptPar,
      supplierId: sid,
      supplierName: sname,
      packSize: Number.isFinite(v?.packSize) ? Number(v.packSize) : null,
      cost: Number(v?.costPrice ?? v?.price ?? v?.unitCost ?? 0) || 0,
      category: s(v?.category || v?.categorySuggested || ''),
    };
  });

  // Per-dept on-hand ONLY from items that exist in that department
  dlog('reading departments/areas/items');
  const onHand: Record<string, Record<string, number>> = {};
  const soldByDept: Record<string, Record<string, number>> = {};
  for (const dep of depsSnap.docs) {
    const depId = dep.id;
    onHand[depId] = onHand[depId] || {};
    const areasSnap = await getDocs(
      collection(db, 'venues', venueId, 'departments', depId, 'areas')
    );
    for (const area of areasSnap.docs) {
      const itemsSnap = await getDocs(
        collection(
          db,
          'venues',
          venueId,
          'departments',
          depId,
          'areas',
          area.id,
          'items'
        )
      );
      itemsSnap.forEach((it) => {
        const v: any = it.data() || {};
        const pid = s(v?.productId || v?.productRef || v?.productLinkId || '');
        const itemName = s(v?.name || '').toLowerCase();

        // Include item if it has ever been counted (lastCount is a number)
        // OR if it has a confirmedCount from a completed stocktake.
        // Skip only if truly never interacted with.
        const hasCount = typeof v?.lastCount === 'number' || typeof v?.confirmedCount === 'number';
        if (!hasCount) return;
        const baseCount = typeof v?.lastCount === 'number' ? v.lastCount : n(v?.confirmedCount, 0);
        const qty = n(baseCount, 0) + n(v?.incomingQty, 0) - n(v?.soldQty, 0);
        const soldQty = n(v?.soldQty, 0);

        if (pid) {
          // Linked item — index by productId
          onHand[depId][pid] = (onHand[depId][pid] || 0) + qty;
          soldByDept[depId] = soldByDept[depId] || {};
          soldByDept[depId][pid] = (soldByDept[depId][pid] || 0) + soldQty;
        } else if (itemName) {
          // Unlinked item — index by name for name-based matching
          const nameKey = `name:${itemName}`;
          onHand[depId][nameKey] = (onHand[depId][nameKey] || 0) + qty;
          soldByDept[depId] = soldByDept[depId] || {};
          soldByDept[depId][nameKey] = (soldByDept[depId][nameKey] || 0) + soldQty;
        }
      });
    }
  }

  // Build name → productId map for unlinked item resolution
  const productIdByNameKey: Record<string, string> = {};
  productsSnap.forEach(d => {
    const name = s((d.data() as any)?.name || '').toLowerCase();
    if (name) productIdByNameKey[`name:${name}`] = d.id;
  });

  // Resolve name-keyed onHand entries to productIds where possible
  for (const depId of Object.keys(onHand)) {
    for (const key of Object.keys(onHand[depId])) {
      if (key.startsWith('name:')) {
        const pid = productIdByNameKey[key];
        if (pid) {
          onHand[depId][pid] = (onHand[depId][pid] || 0) + onHand[depId][key];
          if (soldByDept[depId]?.[key]) {
            soldByDept[depId][pid] = (soldByDept[depId][pid] || 0) + soldByDept[depId][key];
          }
        }
        delete onHand[depId][key];
        if (soldByDept[depId]?.[key]) delete soldByDept[depId][key];
      }
    }
  }

  // Calculate actual cycle duration from area lastConfirmedAt timestamps
  let cycleDays = 7;
  try {
    let latestConfirmedMs = 0;
    for (const dep of depsSnap.docs) {
      const areasSnap2 = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
      areasSnap2.forEach(a => {
        const lca = (a.data() as any)?.lastConfirmedAt;
        const ms = lca?.toMillis?.() ?? (typeof lca === 'number' ? lca : 0);
        if (ms > latestConfirmedMs) latestConfirmedMs = ms;
      });
    }
    if (latestConfirmedMs > 0) {
      const daysSince = (Date.now() - latestConfirmedMs) / (1000 * 60 * 60 * 24);
      cycleDays = Math.min(90, Math.max(1, Math.round(daysSince)));
    }
  } catch {}

  const hasSalesData = Object.values(soldByDept).some(dept =>
    Object.values(dept).some(qty => qty > 0)
  );

  const buckets: Record<string, { supplierName?: string; lines: SuggestedLine[] }> = {};
  const unassigned: { lines: SuggestedLine[] } = { lines: [] };
  const intelligence: SuggestedLine[] = [];

  for (const dep of departments) {
    const depId = dep.id;
    const onHandDept = onHand[depId] || {};
    const productIds = Object.keys(onHandDept); // only products seen in this dept

    for (const pid of productIds) {
      const meta = prodMeta[pid] || {};
      const name = s(meta.name, pid);

      const parDeptRaw =
        meta.deptPar && Number.isFinite(meta.deptPar[depId])
          ? Number(meta.deptPar[depId])
          : Number.isFinite(meta.par)
          ? Number(meta.par)
          : undefined;
      const categoryPar = (() => {
        const cat = (meta.category || '').toLowerCase();
        if (cat.includes('beer') || cat.includes('cider') || cat.includes('rtd')) return 12;
        if (cat.includes('spirit') || cat.includes('whisky') || cat.includes('vodka') || cat.includes('gin') || cat.includes('rum')) return 6;
        if (cat.includes('wine') || cat.includes('champagne') || cat.includes('prosecco')) return 6;
        if (cat.includes('non') || cat.includes('soft') || cat.includes('water') || cat.includes('juice')) return 12;
        if (cat.includes('cocktail') || cat.includes('mix') || cat.includes('syrup')) return 4;
        return defaultPar;
      })();
      const usedPar = Number.isFinite(parDeptRaw) ? Number(parDeptRaw) : categoryPar;

      const onHandQty = n(onHandDept[pid], 0);
      const needed = Math.max(0, usedPar - onHandQty);
      const needsOrder = needed > 0;

      const sid = s(meta.supplierId || '');
      const sname = s(
        meta.supplierName || (sid ? supplierNameById[sid] : ''),
        'Supplier'
      );
      const pack = Number.isFinite(meta.packSize) ? Number(meta.packSize) : null;
      const cost = n(meta.cost, 0);
      const qtyDept = needsOrder
        ? (pack && pack > 0 && roundToPack
            ? Math.ceil(needed / pack) * pack
            : Math.round(needed))
        : 0;

      const totalSold = n((soldByDept[depId] || {})[pid], 0);
      const velocityPerDay = totalSold > 0 && cycleDays > 0
        ? Math.round((totalSold / cycleDays) * 10) / 10
        : null;
      const daysOfCover = velocityPerDay && velocityPerDay > 0 && onHandQty > 0
        ? Math.round(onHandQty / velocityPerDay)
        : null;
      const coverStatus: SuggestedLine['coverStatus'] =
        daysOfCover === null ? 'unknown'
        : daysOfCover <= 2 ? 'critical'
        : daysOfCover <= 7 ? 'low'
        : 'ok';

      const line: SuggestedLine = {
        productId: pid,
        productName: name,
        qty: qtyDept,
        unitCost: cost > 0 ? cost : null,
        packSize: pack,
        cost: cost > 0 ? cost : null,
        needsPar: !Number.isFinite(parDeptRaw),
        needsSupplier: !sid,
        reason: !sid
          ? 'No preferred supplier set'
          : !Number.isFinite(parDeptRaw)
          ? `Dept PAR missing; used default ${usedPar}`
          : null,
        deptId: depId,
        deptName: dep.name,
        qtyDept,
        onHandQty,
        usedPar,
        velocityPerDay,
        daysOfCover,
        coverStatus,
      };

      intelligence.push(line);
      if (needsOrder) {
        if (!sid) {
          unassigned.lines.push(line);
        } else {
          if (!buckets[sid]) buckets[sid] = { supplierName: sname, lines: [] };
          buckets[sid].lines.push(line);
        }
      }
    }
  }

  Object.keys(buckets).forEach((sid) => {
    buckets[sid].lines = (buckets[sid].lines || []).filter(
      (l) => (l.qtyDept ?? l.qty ?? 0) > 0
    );
  });
  unassigned.lines = (unassigned.lines || []).filter(
    (l) => (l.qtyDept ?? l.qty ?? 0) > 0
  );

  const suppliersWithLines =
    Object.values(buckets).filter((b) => (b.lines || []).length > 0).length +
    (unassigned.lines.length > 0 ? 1 : 0);

  const totalLines =
    Object.values(buckets).reduce((a, b) => a + (b.lines?.length || 0), 0) +
    unassigned.lines.length;

  dlog('summary', { suppliersWithLines, totalLines });

  const meta: any = {
    departments,
    suppliersWithLines,
    totalLines,
    generatedAt: new Date().toISOString(),
    stockCycleKey: stockCycleKey || null,
    cycleDays,
    hasSalesData,
  };

  return {
    buckets,
    unassigned,
    intelligence,
    _meta: meta,
  };
}

// Kept for compatibility; currently a no-op because cache is disabled.
export function clearSuggestedOrdersCache() {
  dlog('CACHE disabled; clearSuggestedOrdersCache is a no-op.');
}

/** Legacy shape kept for compatibility with createFromSuggestions/drafts/fromSuggestions. */
export type SuggestedLegacyMap = Record<
  string,
  {
    supplierName?: string | null;
    lines: SuggestedLine[];
  }
>;
