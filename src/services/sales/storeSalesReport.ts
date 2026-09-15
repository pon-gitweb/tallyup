import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  doc,
} from 'firebase/firestore';
import { NormalizedSalesReport } from './types';
import { matchSalesToProducts } from './matchSalesToProducts';

export type OverlappingCycle = {
  departmentId: string;
  cycleNumber: number;
  /** Proportion of the report's total sales that apply to this cycle (0–1).
   *  1.0 for exact single-cycle match; day-weighted fraction for multi-cycle. */
  weight: number;
};

export type StoreSalesReportResult = {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when the report was saved but no completed stocktake cycle overlaps its
   *  declared period — the caller should surface a visible warning to the user. */
  zeroCycleWarning?: boolean;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Returns the number of whole calendar days in the half-open interval [start, end). */
function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

/**
 * After storing the report, find every department snapshot whose [cycleStart, cycleEnd]
 * range overlaps [periodStart, periodEnd], compute per-cycle day-weighted allocations,
 * and write the result back onto the report document.
 *
 * Returns { zeroCycleWarning } — true when no overlapping cycle was found.
 *
 * Read cost: one collection-scan-with-range-filter per department.  For a venue with
 * D departments and an average of C snapshots per department, this is D queries that
 * each return ≤ C docs.  A typical venue (3–5 depts, 5–20 snapshots) costs 15–100
 * reads.  At scale (20 depts × 50 snapshots) this is ~1000 reads.  The `where`
 * clause on cycleEnd prunes cycles that ended before the report period starts, so in
 * practice most venues with a recent report will hit only the most recent 1–3 snapshots
 * per department.  Callers can afford this at upload time; it does NOT run on every
 * health-score calculation.
 */
async function tagOverlappingCycles(
  db: ReturnType<typeof getFirestore>,
  venueId: string,
  reportDocId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ zeroCycleWarning: boolean }> {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

  const overlapping: OverlappingCycle[] = [];

  for (const deptDoc of deptsSnap.docs) {
    // Query only snapshots whose cycleEnd >= periodStart — prunes pre-report history.
    const snapsSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        where('cycleEnd', '>=', Timestamp.fromDate(periodStart)),
        orderBy('cycleEnd', 'asc'),
      ),
    );

    for (const snapDoc of snapsSnap.docs) {
      const data = snapDoc.data() as any;
      // cycleStart is null for snapshots that predate the field (older cycles).
      // Without a cycleStart we cannot determine overlap — skip.
      const rawStart = data.cycleStart;
      if (!rawStart?.toDate) continue;
      const cycleStart: Date = rawStart.toDate();
      const rawEnd = data.cycleEnd;
      if (!rawEnd?.toDate) continue;
      const cycleEnd: Date = rawEnd.toDate();
      const cycleNumber: number = data.cycleNumber ?? 0;
      if (!cycleNumber) continue;

      // Standard interval overlap: reportStart <= cycleEnd AND reportEnd >= cycleStart
      // (cycleEnd >= periodStart is already guaranteed by the Firestore query)
      if (periodEnd >= cycleStart) {
        overlapping.push({ departmentId: deptDoc.id, cycleNumber, weight: 0 });
      }
    }
  }

  // ── Compute allocation weights ────────────────────────────────────────────
  const allocationMethod: 'exact_single_cycle' | 'day_weighted_estimate' | 'none' =
    overlapping.length === 1 ? 'exact_single_cycle' :
    overlapping.length > 1  ? 'day_weighted_estimate' :
    'none';

  if (overlapping.length === 1) {
    overlapping[0].weight = 1;
  } else if (overlapping.length > 1) {
    // For day-weighted allocation we need the cycle boundaries again.
    // Re-query to avoid storing them in the loop above; or just re-run.
    // In practice this is ≤ a handful of cycles; the cost is negligible.
    const cycleBoundaries = new Map<string, { cycleStart: Date; cycleEnd: Date }>();
    for (const deptDoc of deptsSnap.docs) {
      const snapsSnap2 = await getDocs(
        query(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
          where('cycleEnd', '>=', Timestamp.fromDate(periodStart)),
          orderBy('cycleEnd', 'asc'),
        ),
      );
      for (const snapDoc of snapsSnap2.docs) {
        const data = snapDoc.data() as any;
        if (!data.cycleStart?.toDate || !data.cycleEnd?.toDate) continue;
        cycleBoundaries.set(
          `${deptDoc.id}:${data.cycleNumber}`,
          { cycleStart: data.cycleStart.toDate(), cycleEnd: data.cycleEnd.toDate() },
        );
      }
    }

    // Overlap days per cycle
    const overlapDaysPerEntry: number[] = overlapping.map(oc => {
      const b = cycleBoundaries.get(`${oc.departmentId}:${oc.cycleNumber}`);
      if (!b) return 0;
      const overlapStart = b.cycleStart > periodStart ? b.cycleStart : periodStart;
      const overlapEnd   = b.cycleEnd   < periodEnd   ? b.cycleEnd   : periodEnd;
      return daysBetween(overlapStart, overlapEnd);
    });

    const totalOverlapDays = overlapDaysPerEntry.reduce((s, d) => s + d, 0);
    if (totalOverlapDays > 0) {
      overlapping.forEach((oc, i) => {
        oc.weight = overlapDaysPerEntry[i] / totalOverlapDays;
      });
    } else {
      // Equal split fallback (shouldn't happen if boundaries are correct)
      const eq = 1 / overlapping.length;
      overlapping.forEach(oc => { oc.weight = eq; });
    }
  }

  // ── Write back onto the report document ───────────────────────────────────
  await updateDoc(doc(db, 'venues', venueId, 'salesReports', reportDocId), {
    overlappingCycles: overlapping,
    allocationMethod,
  });

  return { zeroCycleWarning: overlapping.length === 0 };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function storeSalesReport(args: {
  venueId: string;
  report: NormalizedSalesReport;
  source: 'csv' | 'pdf';
  /** The period the user has explicitly confirmed at upload time.
   *  Dates are YYYY-MM-DD strings in local time.
   *  When absent (legacy call sites not yet updated) the parsed period is used
   *  for the overlap check, but a console warning is emitted. */
  confirmedPeriod?: { start: string; end: string };
}): Promise<StoreSalesReportResult> {
  try {
    const db = getFirestore(getApp());

    // Determine authoritative period
    const periodSrc = args.confirmedPeriod ?? (args.report.period as { start?: string | null; end?: string | null });
    if (!args.confirmedPeriod && __DEV__) {
      console.warn('[storeSalesReport] confirmedPeriod not supplied — falling back to parsed period. '
        + 'This call site should be updated to pass a user-confirmed period.');
    }

    const rawStart: string | null | undefined = periodSrc?.start;
    const rawEnd:   string | null | undefined = periodSrc?.end;

    const periodStartDate: Date | null = rawStart ? new Date(rawStart + 'T00:00:00') : null;
    const periodEndDate:   Date | null = rawEnd   ? new Date(rawEnd   + 'T23:59:59') : null;

    const periodStartTs = periodStartDate && isFinite(periodStartDate.getTime())
      ? Timestamp.fromDate(periodStartDate) : null;
    const periodEndTs   = periodEndDate   && isFinite(periodEndDate.getTime())
      ? Timestamp.fromDate(periodEndDate)   : null;

    // 1) Store raw report with period timestamps
    const ref = await addDoc(collection(db, 'venues', args.venueId, 'salesReports'), {
      source: args.source,
      report: args.report || null,
      // Top-level flattened period for easy querying by hostiHealth and other readers.
      periodStart: periodStartTs,
      periodEnd: periodEndTs,
      // Overlap tagging written immediately after by tagOverlappingCycles;
      // set sentinels here so readers always find the field.
      overlappingCycles: [],
      allocationMethod: 'none',
      // Lifecycle status — 'active' (default) or 'superseded' (soft-replaced by a newer upload).
      // Superseded reports are kept for audit; excluded from health score calculations.
      status: 'active',
      createdAt: serverTimestamp(),
    });

    // 2) Attempt matching (non-throwing)
    try {
      await matchSalesToProducts({
        venueId: args.venueId,
        reportId: ref.id,
        report: args.report,
      });
    } catch (e: any) {
      if (__DEV__) console.log('[storeSalesReport] matchSalesToProducts failed', e?.message || e);
    }

    // 3) Tag overlapping cycles (requires both period dates; skip if either is absent)
    let zeroCycleWarning = false;
    if (periodStartDate && periodEndDate && isFinite(periodStartDate.getTime()) && isFinite(periodEndDate.getTime())) {
      try {
        const result = await tagOverlappingCycles(db, args.venueId, ref.id, periodStartDate, periodEndDate);
        zeroCycleWarning = result.zeroCycleWarning;
      } catch (e: any) {
        if (__DEV__) console.log('[storeSalesReport] tagOverlappingCycles failed (non-fatal)', e?.message || e);
      }
    }

    return { ok: true, id: ref.id, zeroCycleWarning };
  } catch (e: any) {
    if (__DEV__) console.log('[storeSalesReport] error', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// ─── Supersede helpers ────────────────────────────────────────────────────────

/**
 * Soft-replaces one or more sales reports with a newer one.
 * The old reports are NOT deleted — they remain queryable for audit — but are
 * excluded from active health-score calculations (hostiHealth filters them out).
 *
 * @param venueId       The venue that owns the reports.
 * @param reportIds     IDs of the existing reports to supersede.
 * @param newReportId   ID of the newly-uploaded report that replaces them.
 */
export async function supersedeSalesReports(
  venueId: string,
  reportIds: string[],
  newReportId: string,
): Promise<void> {
  if (!reportIds.length) return;
  const db = getFirestore(getApp());
  await Promise.all(
    reportIds.map(id =>
      updateDoc(doc(db, 'venues', venueId, 'salesReports', id), {
        status: 'superseded',
        supersededBy: newReportId,
        supersededAt: serverTimestamp(),
      }),
    ),
  );
}
