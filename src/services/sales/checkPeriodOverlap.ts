import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';

export type OverlappingReport = {
  id: string;
  /** YYYY-MM-DD or null if the existing report pre-dates period tracking. */
  periodStart: string | null;
  periodEnd: string | null;
  source: 'csv' | 'pdf' | string;
  createdAt: Date | null;
  lineCount: number;
  /** Sum of gross/net revenue across the report's lines, or null if unavailable. */
  totalRevenue: number | null;
};

/**
 * Returns active (non-superseded) salesReports whose stored [periodStart, periodEnd]
 * overlaps the candidate period [newStart, newEnd].
 *
 * Overlap condition (closed intervals):
 *   existingEnd >= newStart  AND  existingStart <= newEnd
 *
 * Firestore can only range-filter on one field per query without a composite index,
 * so we use  where('periodEnd', '>=', startTs)  to prune clearly non-overlapping
 * older reports and check  existingStart <= newEnd  in memory.
 *
 * Reports that pre-date period tracking (no periodEnd stored) are not returned by
 * the range query and are correctly ignored — they have no known period to conflict
 * with.  Superseded reports are excluded in memory.
 */
export async function checkPeriodOverlap(
  venueId: string,
  newStart: string, // YYYY-MM-DD
  newEnd: string,   // YYYY-MM-DD
): Promise<OverlappingReport[]> {
  const db = getFirestore(getApp());

  const startDate = new Date(newStart + 'T00:00:00');
  const endDate   = new Date(newEnd   + 'T23:59:59');
  if (!isFinite(startDate.getTime()) || !isFinite(endDate.getTime())) return [];

  // Prune reports whose periodEnd is before the new report's start date.
  const snap = await getDocs(
    query(
      collection(db, 'venues', venueId, 'salesReports'),
      where('periodEnd', '>=', Timestamp.fromDate(startDate)),
    ),
  );

  const results: OverlappingReport[] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;

    // Exclude superseded reports — they should not block a new upload.
    if (data.status === 'superseded') continue;

    // In-memory check: existingStart must be <= newEnd to complete the overlap.
    const existingStart: Date | null = data.periodStart?.toDate?.() ?? null;
    if (existingStart && existingStart > endDate) continue;

    const existingEnd: Date | null = data.periodEnd?.toDate?.() ?? null;
    const createdAt: Date | null   = data.createdAt?.toDate?.() ?? null;

    const lines: any[] = data.lines || data.report?.lines || [];
    const totalRevenue = lines.reduce((sum: number, l: any) => {
      const v = Number(l.gross ?? l.net ?? 0);
      return sum + (isFinite(v) ? v : 0);
    }, 0);

    results.push({
      id: docSnap.id,
      periodStart: existingStart ? dateToYMD(existingStart) : null,
      periodEnd:   existingEnd   ? dateToYMD(existingEnd)   : null,
      source:      data.source ?? 'csv',
      createdAt,
      lineCount:   lines.length,
      totalRevenue: totalRevenue > 0 ? totalRevenue : null,
    });
  }

  return results;
}

function dateToYMD(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
