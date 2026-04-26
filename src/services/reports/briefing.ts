// @ts-nocheck
import { getAuth } from 'firebase/auth';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

export type VarianceLine = {
  itemId: string;
  name: string;
  varianceUnits: number;  // negative = shortage
  dollarVariance: number; // always positive
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
  let hasPrevCycleData = false;
  let dollarItemCount = 0;

  try {
    const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

    for (const deptDoc of deptsSnap.docs) {
      const deptName = (deptDoc.data() as any)?.name || deptDoc.id;
      const areasSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'),
      );

      for (const areaDoc of areasSnap.docs) {
        const areaData = areaDoc.data() as any;
        const areaName = areaData?.name || areaDoc.id;
        totalAreas++;

        const completedAtMs = toMs(areaData?.completedAt);
        const startedAtMs = toMs(areaData?.startedAt);
        if (completedAtMs) totalAreasCompleted++;

        const durationMins =
          completedAtMs && startedAtMs
            ? Math.max(0, Math.round((completedAtMs - startedAtMs) / 60000))
            : null;

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

          // Counted in current cycle: has lastCountAt and it's newer than confirmedCountAt
          const countedInCycle =
            lastCountAtMs != null &&
            (confirmedCountAtMs == null || lastCountAtMs > confirmedCountAtMs);

          if (!countedInCycle || lastCount == null) continue;

          areaItemsCounted++;
          totalItemsCounted++;

          // Determine baseline for this cycle
          let baseline: number | null = null;
          if (confirmedCount != null && confirmedCountAtMs != null) {
            baseline = confirmedCount;
            hasPrevCycleData = true;
          } else if (parLevel != null) {
            // First cycle — use par as expected
            baseline = parLevel;
          }

          if (baseline == null) continue;

          const varianceUnits = lastCount - baseline;
          const dollar = costPrice != null ? Math.abs(varianceUnits) * costPrice : 0;
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
    }
  } catch (e) {
    console.log('[briefing] fetch error', (e as any)?.message);
  }

  // Sort by dollar impact descending
  allShortages.sort((a, b) => b.dollarVariance - a.dollarVariance);
  allExcesses.sort((a, b) => b.dollarVariance - a.dollarVariance);

  const shortfallDollars = allShortages.reduce((s, r) => s + r.dollarVariance, 0);
  const excessDollars = allExcesses.reduce((s, r) => s + r.dollarVariance, 0);

  return {
    role,
    hasCountData: totalItemsCounted > 0,
    hasPrevCycleData,
    shortfallDollars,
    excessDollars,
    dollarItemCount,
    totalItemsCounted,
    totalAreasCompleted,
    totalAreas,
    topShortages: allShortages.slice(0, 5),
    topExcesses: allExcesses.slice(0, 3),
    trendItems: trendItems.slice(0, 5),
    areaStats,
  };
}
