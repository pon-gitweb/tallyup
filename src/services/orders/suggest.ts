import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, getDoc, setDoc, doc,
} from 'firebase/firestore';

export type SuggestedLine = {
  productId: string;
  productName?: string | null;
  qty: number;            // suggested units
  cost: number;           // unit cost (ex GST)
  needsPar?: boolean;     // suggested 1 pack due to no par & zero stock
  needsSupplier?: boolean;// missing supplier
  reason?: string | null; // 'no_par_zero_stock' | 'no_supplier'
};

export type ItemsMap = Record<string, SuggestedLine>;
export type CompatBucket = ItemsMap & { items: ItemsMap; lines: SuggestedLine[] };
export type SuggestedLegacyMap = Record<string, CompatBucket>;

export type SuggestOpts = {
  roundToPack?: boolean;
  defaultParIfMissing?: number; // fallback when no par/pack
};

type ProductDoc = {
  id: string;
  name?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  packSize?: number | null;
  price?: number | null;
  cost?: number | null;
  par?: number | null;
  parLevel?: number | null;
};

type AreaItemDoc = {
  id: string;
  productLinkId?: string | null;  // item.productId OR productRef.id
  name?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  packSize?: number | null;
  price?: number | null;
  cost?: number | null;
  value?: number | null;          // last counted qty (on-hand)
};

const toNumOrNull = (v: any): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Number(n) : null;
};

function newCompatBucket(): CompatBucket {
  const base: any = {};
  base.items = {};
  base.lines = [];
  return base as CompatBucket;
}

// Normalize any bucket-ish object into a CompatBucket with {items, lines}
function finalizeBucket(anyBucket: any): CompatBucket {
  if (!anyBucket || typeof anyBucket !== 'object') return newCompatBucket();

  let items: ItemsMap | null =
    anyBucket.items && typeof anyBucket.items === 'object' ? (anyBucket.items as ItemsMap) : null;

  if (!items) {
    const derived: ItemsMap = {};
    for (const k of Object.keys(anyBucket)) {
      if (k === 'items' || k === 'lines') continue;
      const v = (anyBucket as any)[k];
      if (v && typeof v === 'object' && 'productId' in v) {
        derived[k] = v as SuggestedLine;
      }
    }
    items = derived;
  }

  const out: any = {};
  for (const pid of Object.keys(items)) out[pid] = items[pid];
  out.items = items;
  out.lines = Object.values(items);
  return out as CompatBucket;
}

function finalizeStore(store: Record<string, any>): SuggestedLegacyMap {
  const out: SuggestedLegacyMap = {} as any;
  for (const k of Object.keys(store)) {
    out[k] = finalizeBucket(store[k]);
  }
  return out;
}

async function ensureUnassignedSupplierDoc(db: ReturnType<typeof getFirestore>, venueId: string) {
  const ref = doc(db, 'venues', venueId, 'suppliers', 'unassigned');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: 'Unassigned',
      createdAt: new Date(),
      system: true,
      note: 'Auto-created to host lines with missing supplier.',
    }, { merge: true });
  }
}

async function loadProducts(db: ReturnType<typeof getFirestore>, venueId: string): Promise<ProductDoc[]> {
  const out: ProductDoc[] = [];
  const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
  snap.forEach(d => {
    const p = d.data() as any;
    out.push({
      id: d.id,
      name: p?.name ?? p?.productName ?? null,
      supplierId: p?.supplierId ?? null,
      supplierName: p?.supplierName ?? null,
      packSize: toNumOrNull(p?.packSize),
      price: toNumOrNull(p?.price),
      cost: toNumOrNull(p?.cost),
      par: toNumOrNull(p?.par ?? p?.parLevel),
      parLevel: toNumOrNull(p?.parLevel),
    });
  });
  return out;
}

async function loadAreaItems(db: ReturnType<typeof getFirestore>, venueId: string): Promise<AreaItemDoc[]> {
  const out: AreaItemDoc[] = [];
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areas.docs) {
      const items = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      items.forEach(d => {
        const it = d.data() as any;
        const linkId = it?.productId ?? it?.productRef?.id ?? it?.product?.id ?? null;
        out.push({
          id: d.id,
          productLinkId: linkId,
          name: it?.name ?? it?.productName ?? null,
          supplierId: it?.supplierId ?? null,
          supplierName: it?.supplierName ?? null,
          packSize: toNumOrNull(it?.packSize),
          price: toNumOrNull(it?.price),
          cost: toNumOrNull(it?.cost),
          value: toNumOrNull(it?.value),
        });
      });
    }
  }
  return out;
}

function ensureBucket(store: Record<string, any>, key: string): any {
  if (!store[key]) store[key] = newCompatBucket();
  return store[key];
}

/** Return a Proxy map so suggestions["any-missing-key"] safely yields an empty compat bucket. */
function withDefaultBucket(map: SuggestedLegacyMap): SuggestedLegacyMap {
  return new Proxy(map as any, {
    get(target: any, prop: string | symbol, receiver: any) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!(prop in target)) {
        target[prop] = finalizeBucket(newCompatBucket());
      }
      return target[prop];
    }
  }) as any;
}

export async function buildSuggestedOrdersInMemory(
  venueId: string,
  opts: SuggestOpts = {}
): Promise<SuggestedLegacyMap> {
  const db = getFirestore(getApp());
  const roundToPack = !!opts.roundToPack;
  const defaultPar = Number.isFinite(opts.defaultParIfMissing) ? Number(opts.defaultParIfMissing) : 6;

  // Buckets keyed by supplierId.
  const store: Record<string, any> = {};
  await ensureUnassignedSupplierDoc(db, venueId);
  const unassigned = ensureBucket(store, 'unassigned');

  // Legacy alias keys → point to the same bucket
  for (const alias of ['__no_supplier__', 'no_supplier', 'none', 'null', 'undefined', '']) {
    store[alias] = unassigned;
  }

  // Seed real suppliers (so UI can iterate safely)
  try {
    const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
    suppliersSnap.forEach(s => ensureBucket(store, s.id));
  } catch (e) {
    console.warn('[SuggestedOrders] suppliers seed error', e);
  }

  // Load data
  const [products, areaItems] = await Promise.all([
    loadProducts(db, venueId),
    loadAreaItems(db, venueId),
  ]);

  // Inventory-first on-hand from area-items
  const onHandByProductId: Record<string, number> = {};
  const orphanAreaItems: AreaItemDoc[] = [];
  for (const it of areaItems) {
    const pid = it.productLinkId;
    const v = Number(it.value ?? 0);
    if (pid) {
      if (Number.isFinite(v)) onHandByProductId[pid] = (onHandByProductId[pid] ?? 0) + v;
    } else {
      orphanAreaItems.push(it);
    }
  }
  const countedIds = new Set(Object.keys(onHandByProductId));
  console.log('[SuggestedOrders] countedProductIds', { count: countedIds.size });

  // Index products
  const productById: Record<string, ProductDoc> = {};
  for (const p of products) productById[p.id] = p;

  // Counted products → suggestions
  for (const pid of countedIds) {
    const p = productById[pid] || null;
    const onHand = onHandByProductId[pid] ?? 0;

    const name = p?.name ?? null;
    const supplierId = p?.supplierId ?? null;
    const packSize = Number.isFinite(p?.packSize as any) && (p!.packSize as any) > 0 ? Number(p!.packSize) : 1;
    const unitCost = Number.isFinite(p?.price as any) ? Number(p!.price)
                   : Number.isFinite(p?.cost as any) ? Number(p!.cost) : 0;
    const explicitPar = Number.isFinite(p?.par as any) ? Number(p!.par)
                      : Number.isFinite(p?.parLevel as any) ? Number(p!.parLevel) : null;

    const bucket = ensureBucket(store, supplierId ?? 'unassigned');

    if (explicitPar && explicitPar > 0) {
      const deficit = explicitPar - onHand;
      if (deficit > 0) {
        const qty = roundToPack ? Math.ceil(deficit / packSize) * packSize : deficit;
        const line: SuggestedLine = { productId: pid, productName: name, qty, cost: unitCost };
        (bucket as any)[pid] = line;
        bucket.items[pid] = line;
      }
    } else if (onHand <= 0) {
      const qty = packSize > 0 ? packSize : Math.max(1, defaultPar);
      const line: SuggestedLine = {
        productId: pid, productName: name, qty, cost: unitCost, needsPar: true, reason: 'no_par_zero_stock'
      };
      (bucket as any)[pid] = line;
      bucket.items[pid] = line;
    }

    if (!supplierId) {
      const line = (bucket as any)[pid] as SuggestedLine | undefined;
      if (line) {
        line.needsSupplier = true;
        line.reason = line.reason ?? 'no_supplier';
      }
    }
  }

  // Orphans: area-items with no linked product
  for (const it of orphanAreaItems) {
    const onHand = Number.isFinite(it.value as any) ? Number(it.value) : 0;
    if (onHand > 0) continue;

    const packSize = Number.isFinite(it.packSize as any) && Number(it.packSize) > 0 ? Number(it.packSize) : 1;
    const qty = packSize > 0 ? packSize : Math.max(1, defaultPar);
    const unitCost = Number.isFinite(it.price as any) ? Number(it.price)
                   : Number.isFinite(it.cost as any) ? Number(it.cost) : 0;

    const bucket = ensureBucket(store, it.supplierId ?? 'unassigned');
    const pid = it.id;
    const line: SuggestedLine = {
      productId: pid,
      productName: it.name ?? null,
      qty,
      cost: unitCost,
      needsPar: true,
      needsSupplier: !it.supplierId,
      reason: !it.supplierId ? 'no_supplier' : 'no_par_zero_stock',
    };
    (bucket as any)[pid] = line;
    bucket.items[pid] = line;
  }

  // Finalize compat shape and wrap with Proxy that guarantees buckets for any key
  const compat = finalizeStore(store);

  // Diagnostics (avoid alias double counting by tracking object identity)
  let suppliersWithLines = 0, totalLines = 0;
  const perSupplierCounts: Record<string, number> = {};
  const seen = new Set<CompatBucket>();
  for (const key of Object.keys(compat)) {
    const b = compat[key];
    if (seen.has(b)) continue;
    seen.add(b);
    const c = b.lines.length;
    perSupplierCounts[key] = c;
    if (c > 0) { suppliersWithLines++; totalLines += c; }
  }
  console.log('[SuggestedOrders] summary', { suppliersWithLines, totalLines });
  console.log('[SuggestedOrders] perSupplierCounts', perSupplierCounts);

  return withDefaultBucket(compat);
}
