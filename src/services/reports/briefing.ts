import { getAuth } from 'firebase/auth';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

export type VarianceLine = {
  itemId: string;
  name: string;
  varianceUnits: number;  // negative = shortage
  dollarVariance: number | null; // positive, or null when item has no cost price
  deptName: string;
  areaName: string;
};

export type TrendItem = {
  itemId: string;
  name: string;
  deptName: string;
};

export type AreaStat = {
  areaId: string;
  areaName: string;
  deptName: string;
  durationMins: number | null;
  itemsCounted: number;
  totalItems: number;
  shortItems: number;
};

export type BriefingData = {
  role: 'owner' | 'manager' | 'staff' | null;
  hasCountData: boolean;
  hasPrevCycleData: boolean;
  shortfallDollars: number;
  excessDollars: number;
  dollarItemCount: number;
  totalItemsCounted: number;
  totalAreasCompleted: number;
  totalAreas: number;
  lastStocktakeDate: string | null;
  topShortages: VarianceLine[];
  topExcesses: VarianceLine[];
  trendItems: TrendItem[];
  areaStats: AreaStat[];
};

function toMs(val: any): number | null {
  if (!val) return null;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') return val;
  return null;
}

export async function fetchBriefing(venueId: string): Promise<BriefingData> {
  const uid = getAuth().currentUser?.uid ?? null;

  // Determine role
  let role: BriefingData['role'] = null;
  try {
    const venueSnap = await getDoc(doc(db, 'venues', venueId));
    const venueData = venueSnap.exists() ? (venueSnap.data() as any) : null;
    if (uid && venueData?.ownerUid === uid) {
      role = 'owner';
    } else if (uid) {
      const memberSnap = await getDoc(doc(db, 'venues', venueId, 'members', uid));
      if (memberSnap.exists()) {
        const r = (memberSnap.data() as any)?.role;
        role = r === 'owner' || r === 'manager' || r === 'staff' ? r : 'staff';
      }
    }
  } catch {}

  const allShortages: VarianceLine[] = [];
  const allExcesses: VarianceLine[] = [];
  const trendItems: TrendItem[] = [];
  const areaStats: AreaStat[] = [];

  let totalItemsCounted = 0;
  let totalAreasCompleted = 0;
  let totalAreas = 0;
  let hasCountData = false;
  let hasPrevCycleData = false;
  let dollarItemCount = 0;
  let latestCompletedAtMs: number | null = null;

  try {
    const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

    // Fetch all areas in parallel across all departments
    const deptAreaPairs = await Promise.all(
      deptsSnap.docs.map(async deptDoc => {
        const areasSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'),
        );
        return { deptDoc, areasSnap };
      })
    );

    // Fetch all items in parallel across all areas
    const allAreaData = await Promise.all(
      deptAreaPairs.flatMap(({ deptDoc, areasSnap }) =>
        areasSnap.docs.map(async areaDoc => {
          const itemsSnap = await getDocs(
            collection(
              db,
              'venues',
              venueId,
              'departments',
              deptDoc.id,
              'areas',
              areaDoc.id,
              'items',
            ),
          );
          return { deptDoc, areaDoc, itemsSnap };
        })
      )
    );

    // Process all in a single synchronous loop
    for (const { deptDoc, areaDoc, itemsSnap } of allAreaData) {
      const deptName = (deptDoc.data() as any)?.name || deptDoc.id;
      const areaData = areaDoc.data() as any;
      const areaName = areaData?.name || areaDoc.id;
      totalAreas++;

      const completedAtMs = toMs(areaData?.completedAt);
      const startedAtMs = toMs(areaData?.startedAt);
      if (completedAtMs) {
        totalAreasCompleted++;
        if (latestCompletedAtMs == null || completedAtMs > latestCompletedAtMs) {
          latestCompletedAtMs = completedAtMs;
        }
      }

      const durationMins =
        completedAtMs && startedAtMs
          ? Math.max(0, Math.round((completedAtMs - startedAtMs) / 60000))
          : null;

      let areaItemsCounted = 0;
      let areaItemsShort = 0;

      for (const itemDoc of itemsSnap.docs) {
        const d = itemDoc.data() as any;
        const lastCount = typeof d.lastCount === 'number' ? d.lastCount : null;
        const confirmedCount =
          typeof d.confirmedCount === 'number' ? d.confirmedCount : null;
        const parLevel = typeof d.parLevel === 'number' ? d.parLevel : null;
        const costPrice = typeof d.costPrice === 'number' ? d.costPrice : null;
        const lastCountAtMs = toMs(d.lastCountAt);
        const confirmedCountAtMs = toMs(d.confirmedCountAt);
        const name = d.name || itemDoc.id;

        // Count data gate — survives reset (lastCount is restored from confirmedCount after reset).
        // Zero is a valid count: gate on whether the item was ever counted (timestamp set),
        // not on the value being truthy/positive.
        if (lastCountAtMs != null || confirmedCountAtMs != null) {
          hasCountData = true;
        }
        // A previous cycle exists if confirmedCountAt is set — even if the value was zero.
        if (confirmedCountAtMs != null) hasPrevCycleData = true;

        // Variance only for items counted in the current cycle.
        // Third condition: if both lastCountAt and confirmedCountAt are at or before
        // the area's completedAt, the item was counted in this cycle — handles the case
        // where completeArea writes confirmedCountAt (T2) after lastCountAt (T1).
        const countedInCycle =
          lastCountAtMs != null && (
            confirmedCountAtMs == null ||
            lastCountAtMs > confirmedCountAtMs ||
            (completedAtMs != null && lastCountAtMs <= completedAtMs && confirmedCountAtMs <= completedAtMs)
          );

        if (!countedInCycle || lastCount === null || lastCount === undefined) continue;

        areaItemsCounted++;
        totalItemsCounted++;

        // Determine baseline for this cycle
        let baseline: number | null = null;
        if (confirmedCount != null && confirmedCountAtMs != null) {
          baseline = confirmedCount;
        } else if (parLevel != null) {
          // First cycle — use par as expected
          baseline = parLevel;
        }

        if (baseline == null) continue;

        const varianceUnits = lastCount - baseline;
        const dollar: number | null = costPrice != null ? Math.abs(varianceUnits) * costPrice : null;
        if (costPrice != null) dollarItemCount++;

        if (varianceUnits < 0) {
          allShortages.push({
            itemId: itemDoc.id,
            name,
            varianceUnits,
            dollarVariance: dollar,
            deptName,
            areaName,
          });
          areaItemsShort++;
        } else if (varianceUnits > 0) {
          allExcesses.push({
            itemId: itemDoc.id,
            name,
            varianceUnits,
            dollarVariance: dollar,
            deptName,
            areaName,
          });
        }

        // Trend: short in both previous and current cycle
        if (
          confirmedCount != null &&
          parLevel != null &&
          confirmedCount < parLevel &&
          lastCount < parLevel
        ) {
          trendItems.push({ itemId: itemDoc.id, name, deptName });
        }
      }

      areaStats.push({
        areaId: areaDoc.id,
        areaName,
        deptName,
        durationMins,
        itemsCounted: areaItemsCounted,
        totalItems: itemsSnap.size,
        shortItems: areaItemsShort,
      });
    }
  } catch (e) {
    console.log('[briefing] fetch error', (e as any)?.message);
  }

  // Sort by dollar impact descending
  allShortages.sort((a, b) => (b.dollarVariance ?? 0) - (a.dollarVariance ?? 0));
  allExcesses.sort((a, b) => (b.dollarVariance ?? 0) - (a.dollarVariance ?? 0));

  const shortfallDollars = allShortages.reduce((s, r) => s + (r.dollarVariance ?? 0), 0);
  const excessDollars = allExcesses.reduce((s, r) => s + (r.dollarVariance ?? 0), 0);
  const lastStocktakeDate = latestCompletedAtMs
    ? new Date(latestCompletedAtMs).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return {
    role,
    hasCountData,
    hasPrevCycleData,
    shortfallDollars,
    excessDollars,
    dollarItemCount,
    totalItemsCounted,
    totalAreasCompleted,
    totalAreas,
    lastStocktakeDate,
    topShortages: allShortages.slice(0, 5),
    topExcesses: allExcesses.slice(0, 3),
    trendItems: trendItems.slice(0, 5),
    areaStats,
  };
}
