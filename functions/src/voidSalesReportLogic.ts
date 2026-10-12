/**
 * Core logic for voiding a salesReport document and cleaning up derived
 * collections.  Extracted from the /sales-reports/void HTTP endpoint so it
 * can be unit-tested without spinning up an Express server.
 *
 * All Firestore access is done via the `db` parameter so tests can pass a
 * mock database.
 */
import * as admin from 'firebase-admin';

export type VoidResult =
  | { ok: true; alreadyVoided: true }
  | { ok: true; voidedAt: string; needsReenrich: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

const CHUNK = 400;

async function deleteByReportId(
  db: admin.firestore.Firestore,
  collPath: string,
  reportId: string,
): Promise<void> {
  const snap = await db.collection(collPath).where('reportId', '==', reportId).get();
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch();
    snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export async function voidSalesReportLogic(
  db: admin.firestore.Firestore,
  venueId: string,
  reportId: string,
  uid: string,
  reason: string,
): Promise<VoidResult> {
  // Validate IDs before any database access — rejects slashes, dots, and
  // path-traversal payloads that would resolve to unintended documents.
  if (typeof venueId !== 'string' || !ID_RE.test(venueId)) {
    return { ok: false, status: 400, error: 'Invalid venueId' };
  }
  if (typeof reportId !== 'string' || !ID_RE.test(reportId)) {
    return { ok: false, status: 400, error: 'Invalid reportId' };
  }
  if (!reason || String(reason).trim().length < 3) {
    return { ok: false, status: 400, error: 'reason must be at least 3 characters' };
  }

  // Role check: manager or owner only.
  const memberDoc = await db.doc(`venues/${venueId}/members/${uid}`).get();
  if (!memberDoc.exists) {
    return { ok: false, status: 403, error: 'You are not a member of this venue' };
  }
  const role = (memberDoc.data() as any)?.role as string | undefined;
  if (role !== 'manager' && role !== 'owner') {
    return { ok: false, status: 403, error: 'Only managers and owners can void sales reports' };
  }

  const reportRef = db.doc(`venues/${venueId}/salesReports/${reportId}`);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    return { ok: false, status: 404, error: 'Report not found' };
  }

  const reportData = reportSnap.data() as any;

  // Idempotency: already voided AND cleanup complete → no-op.
  if (reportData.status === 'voided' && reportData.voidCleanupComplete === true) {
    return { ok: true, alreadyVoided: true };
  }

  const trimmedReason = String(reason).trim();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Set voided status if not already set (idempotent on resume).
  if (reportData.status !== 'voided') {
    await reportRef.update({
      status: 'voided',
      voidedAt: now,
      voidedBy: uid,
      voidReason: trimmedReason,
      voidCleanupComplete: false,
    });
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const venuePath = `venues/${venueId}`;

  await deleteByReportId(db, `${venuePath}/salesReportMatches`,       reportId);
  await deleteByReportId(db, `${venuePath}/salesReportUnknowns`,      reportId);
  await deleteByReportId(db, `${venuePath}/salesReportRecipeMatches`, reportId);
  await deleteByReportId(db, `${venuePath}/recipeSalesAttribution`,   reportId);

  // Delete salesReportMatches doc keyed by reportId (server-side path).
  const matchByIdRef = db.doc(`${venuePath}/salesReportMatches/${reportId}`);
  const matchByIdSnap = await matchByIdRef.get();
  if (matchByIdSnap.exists) await matchByIdRef.delete();

  // Delete processedSalesReports entries by reportId field (web-written records).
  await deleteByReportId(db, `${venuePath}/processedSalesReports`, reportId);

  // Delete processedSalesReports doc keyed by fileHash if present.
  const fileHash = reportData?.meta?.fileHash;
  if (fileHash) {
    const hashRef = db.doc(`${venuePath}/processedSalesReports/${fileHash}`);
    const hashSnap = await hashRef.get();
    if (hashSnap.exists) await hashRef.delete();
  }

  await reportRef.update({ voidCleanupComplete: true });

  await db.collection(`${venuePath}/auditLog`).add({
    action: 'void_sales_report',
    reportId,
    voidedBy: uid,
    voidedAt: now,
    voidReason: trimmedReason,
    createdAt: now,
  });

  return { ok: true, voidedAt: new Date().toISOString(), needsReenrich: true };
}
