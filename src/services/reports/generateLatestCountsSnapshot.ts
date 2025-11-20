// @ts-nocheck
/**
 * Generate item-level latestCounts snapshot for variance math.
 *
 * Shape written:
 *   venues/{venueId}/reports/latestCounts
 *   {
 *     generatedAt: <serverTimestamp>,
 *     rows: [
 *       {
 *         sku: string,
 *         name?: string,
 *         unitCost?: number,
 *         department: string,
 *         onHand: number,
 *         expected?: number
 *       },
 *       ...
 *     ]
 *   }
 *
 * This is exactly what fetchCounts(...) in dataAdapters.ts expects.
 */

import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

type SnapshotRow = {
  sku: string;
  name?: string;
  unitCost?: number;
  department?: string;
  onHand: number;
  expected?: number;
};

const dlog = (...a: any[]) => {
  if (__DEV__) console.log('[latestCounts.snapshot]', ...a);
};

function num(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Walk all departments → areas → items and build item-level rows.
 *
 * Assumptions about item docs (best-effort, non-breaking):
 *   - sku: productId || productRef || itemId
 *   - name: productName || name || sku
 *   - unitCost: costPrice || cost
 *   - onHand: lastCount (0 if missing)
 *   - expected: par || parLevel (0 if missing)
 *
 * If a field is missing we fall back safely; the math will still run,
 * just with weaker precision for that item.
 */
export async function generateLatestCountsSnapshot(venueId: string): Promise<void> {
  if (!venueId) throw new Error('venueId is required');

  dlog('start', venueId);
  const rows: SnapshotRow[] = [];

  // 1) Departments
  const depsSnap = await getDocs(collection(db, `venues/${venueId}/departments`));

  for (const depDoc of depsSnap.docs) {
    const departmentId = depDoc.id;

    // 2) Areas under each department
    const areasSnap = await getDocs(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas`)
    );

    for (const areaDoc of areasSnap.docs) {
      const areaId = areaDoc.id; // not used yet but kept for future filters

      // 3) Items under each area
      const itemsSnap = await getDocs(
        collection(
          db,
          `venues/${venueId}/departments/${departmentId}/areas/${areaId}/items`
        )
      );

      for (const itemDoc of itemsSnap.docs) {
        const it: any = itemDoc.data() || {};
        const sku =
          String(it.productId || it.productRef || itemDoc.id || '').trim() ||
          itemDoc.id;

        const name =
          (it.productName as string) ||
          (it.name as string) ||
          sku;

        const unitCostRaw =
          it.costPrice ??
          it.cost ??
          null;

        const unitCost =
          unitCostRaw != null && Number.isFinite(Number(unitCostRaw))
            ? Number(unitCostRaw)
            : undefined;

        const onHand = num(it.lastCount, 0);

        const expectedRaw =
          it.par ??
          it.parLevel ??
          null;

        const expected =
          expectedRaw != null && Number.isFinite(Number(expectedRaw))
            ? Number(expectedRaw)
            : undefined;

        rows.push({
          sku,
          name,
          unitCost,
          department: departmentId,
          onHand,
          expected,
        });
      }
    }
  }

  dlog('rows', rows.length);

  // 4) Write snapshot doc in the format fetchCounts() already knows
  const ref = doc(db, `venues/${venueId}/reports/latestCounts`);
  await setDoc(
    ref,
    {
      generatedAt: serverTimestamp(),
      rows,
    },
    { merge: true }
  );

  dlog('done');
}

export default generateLatestCountsSnapshot;
