import { db } from '../../services/firebase';
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
} from 'firebase/firestore';

export type LastCycleTopVariance = {
  productId: string;
  name: string;
  variance: number;           // onHand - par
  unitCost?: number | null;
  valueImpact?: number;       // abs(variance) * unitCost
};

export type LastCycleSummary = {
  generatedAt: any;           // Firestore Timestamp
  departments: number;
  areasTotal: number;
  areasCompleted: number;
  areasInProgress: number;
  itemsCounted: number;
  shortages: number;
  excesses: number;
  valueImpact: number;        // sum(abs(variance)*cost) for all products we could price
  topVariances: LastCycleTopVariance[];
};

async function fetchDepartments(venueId: string) {
  const col = collection(db, 'venues', venueId, 'departments');
  return await getDocs(col);
}

async function fetchAreas(venueId: string, departmentId: string) {
  const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
  return await getDocs(col);
}

async function fetchItems(venueId: string, departmentId: string, areaId: string) {
  const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
  return await getDocs(col);
}

async function fetchProducts(venueId: string) {
  const col = collection(db, 'venues', venueId, 'products');
  return await getDocs(col);
}

async function fetchProductCheapestPrice(venueId: string, productId: string): Promise<number | null> {
  // products/{id}/prices/*
  const col = collection(db, 'venues', venueId, 'products', productId, 'prices');
  const snap = await getDocs(col);
  if (snap.empty) return null;
  let cheapest: number | null = null;
  snap.forEach(d => {
    const v = (d.data() as any)?.unitCost;
    if (typeof v === 'number' && !Number.isNaN(v)) {
      if (cheapest == null || v < cheapest) cheapest = v;
    }
  });
  return cheapest;
}

/**
 * Reads current dept/area item counts to form a last-cycle snapshot.
 * This runs *on-demand* and writes to venues/{venueId}/reports/lastCycle.
 * Heavy reads happen here once; the report screen then loads the single doc.
 */
export async function computeAndSaveLastCycle(venueId: string): Promise<LastCycleSummary> {
  // 1) structure and counters
  const depSnap = await fetchDepartments(venueId);
  const departments = depSnap.size;

  let areasTotal = 0;
  let areasCompleted = 0;
  let areasInProgress = 0;
  let itemsCounted = 0;

  // Build onHand per product: sum of lastCount across all areas/items
  const onHandByProduct: Record<string, number> = {};

  // Walk depts → areas → items (only once now)
  for (const depDoc of depSnap.docs) {
    const depId = depDoc.id;
    const areaSnap = await fetchAreas(venueId, depId);
    areasTotal += areaSnap.size;

    areaSnap.forEach(a => {
      const ad = a.data() as any;
      const started = ad?.startedAt || null;
      const completed = ad?.completedAt || null;
      if (completed) areasCompleted += 1;
      else if (started && !completed) areasInProgress += 1;
    });

    for (const areaDoc of areaSnap.docs) {
      const areaId = areaDoc.id;
      const itemSnap = await fetchItems(venueId, depId, areaId);
      itemSnap.forEach(it => {
        const d = it.data() as any;
        const pid = d?.productId || it.id; // fallback to item id
        const count = Number(d?.lastCount ?? 0);
        const counted = d?.lastCountAt ? true : false;
        if (counted) itemsCounted += 1;
        if (!Number.isFinite(count)) return;
        onHandByProduct[pid] = (onHandByProduct[pid] ?? 0) + count;
      });
    }
  }

  // 2) Compare to par + cost from products
  const prodSnap = await fetchProducts(venueId);
  const parByProduct: Record<string, number> = {};
  const nameByProduct: Record<string, string> = {};
  const priceCache: Record<string, number | null> = {};

  prodSnap.forEach(p => {
    const d = p.data() as any;
    const par = Number(d?.par ?? 0);
    parByProduct[p.id] = Number.isFinite(par) ? par : 0;
    nameByProduct[p.id] = d?.name || p.id;
  });

  let shortages = 0;
  let excesses = 0;
  let totalValueImpact = 0;
  const topList: LastCycleTopVariance[] = [];

  // union of products present either in products or in onHand map
  const productIds = new Set<string>([...Object.keys(parByProduct), ...Object.keys(onHandByProduct)]);

  for (const pid of productIds) {
    const onHand = onHandByProduct[pid] ?? 0;
    const par = parByProduct[pid] ?? 0;
    const variance = onHand - par;
    if (variance < 0) shortages += 1;
    else if (variance > 0) excesses += 1;

    // cheapest price (cached)
    if (!(pid in priceCache)) {
      try { priceCache[pid] = await fetchProductCheapestPrice(venueId, pid); }
      catch { priceCache[pid] = null; }
    }
    const unitCost = priceCache[pid];
    const valueImpact = (unitCost != null) ? Math.abs(variance) * unitCost : undefined;

    if (valueImpact != null) totalValueImpact += valueImpact;

    topList.push({
      productId: pid,
      name: nameByProduct[pid] ?? pid,
      variance,
      unitCost: unitCost ?? null,
      valueImpact,
    });
  }

  // Top 5 by absolute value impact (fallback: by |variance| if no price)
  topList.sort((a, b) => {
    const av = (a.valueImpact != null) ? a.valueImpact : Math.abs(a.variance);
    const bv = (b.valueImpact != null) ? b.valueImpact : Math.abs(b.variance);
    return bv - av;
  });
  const topVariances = topList.slice(0, 5);

  const payload: LastCycleSummary = {
    generatedAt: serverTimestamp(),
    departments,
    areasTotal,
    areasCompleted,
    areasInProgress,
    itemsCounted,
    shortages,
    excesses,
    valueImpact: Number(totalValueImpact.toFixed(2)),
    topVariances,
  };

  const repRef = doc(db, 'venues', venueId, 'reports', 'lastCycle');
  await setDoc(repRef, payload, { merge: true });
  return payload;
}

export async function readLastCycleSummary(venueId: string): Promise<LastCycleSummary | null> {
  const repRef = doc(db, 'venues', venueId, 'reports', 'lastCycle');
  const snap = await getDoc(repRef);
  if (!snap.exists()) return null;
  return snap.data() as LastCycleSummary;
}
