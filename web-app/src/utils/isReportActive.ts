/**
 * Returns true when a salesReports document should be treated as active.
 * "active" means the report's data counts toward health scores, snapshot
 * soldQty, period-overlap checks, and AI context.
 *
 * Legacy documents predate the status field (undefined) and are treated as
 * active.  Any explicit non-active value ('superseded', 'voided', or any
 * future inactive state) returns false.
 */
export function isReportActive(data: { status?: string | null }): boolean {
  const s = data.status;
  return s === undefined || s === null || s === 'active';
}
