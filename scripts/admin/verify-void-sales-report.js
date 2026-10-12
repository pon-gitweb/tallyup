#!/usr/bin/env node
/**
 * verify-void-sales-report.js
 *
 * Integration smoke-test for voidSalesReportLogic.
 * Creates a throwaway venue, seeds one report and one document in every
 * derived collection, runs the cleanup, asserts everything is gone, then
 * deletes the throwaway venue regardless of outcome (try/finally).
 *
 * DRY-RUN by default — prints what it would do.
 * Pass --execute to actually write and delete.
 *
 * Usage:
 *   node scripts/admin/verify-void-sales-report.js
 *   node scripts/admin/verify-void-sales-report.js --execute
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or a local firebase-admin init.
 * NEVER touches any real venue — the throwaway venueId is prefixed with
 * "_verify_void_" and is created and deleted within the same run.
 */

'use strict';

const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const VENUE_PREFIX = '_verify_void_';
const VENUE_ID     = VENUE_PREFIX + Date.now();
const REPORT_ID    = 'test_report_001';
const OWNER_UID    = 'test_owner_uid';
const FILE_HASH    = 'test_file_hash_abc';

function log(msg) { console.log(`[verify-void] ${msg}`); }
function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ FAIL: ${msg}`); process.exitCode = 1; }

// ── Dry-run path ──────────────────────────────────────────────────────────────

if (!EXECUTE) {
  log('DRY-RUN mode. Pass --execute to run against Firestore.');
  log(`Would create throwaway venue: ${VENUE_ID}`);
  log(`Would seed salesReports/${REPORT_ID} + one doc in each derived collection.`);
  log(`Would run voidSalesReportLogic(db, ${VENUE_ID}, ${REPORT_ID}, ${OWNER_UID}, 'verify run').`);
  log('Would assert: report.status === voided, all derived docs gone.');
  log('Would delete the throwaway venue (try/finally).');
  log('Re-run with --execute to perform the real check.');
  process.exit(0);
}

// ── Execute path ──────────────────────────────────────────────────────────────

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const { voidSalesReportLogic } = require('../../functions/src/voidSalesReportLogic');

const venue = `venues/${VENUE_ID}`;

async function seedVenue() {
  const batch = db.batch();

  // Member doc so the role check passes.
  batch.set(db.doc(`${venue}/members/${OWNER_UID}`), { role: 'owner' });

  // The sales report.
  batch.set(db.doc(`${venue}/salesReports/${REPORT_ID}`), {
    status: 'active',
    meta: { fileHash: FILE_HASH },
    report: { lines: [], period: { start: '2026-01-01', end: '2026-01-07' } },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // One doc in every derived collection.
  batch.set(db.doc(`${venue}/salesReportMatches/${REPORT_ID}`),      { reportId: REPORT_ID }); // keyed by reportId
  batch.set(db.doc(`${venue}/salesReportMatches/match_auto`),        { reportId: REPORT_ID }); // addDoc-style
  batch.set(db.doc(`${venue}/salesReportUnknowns/unk1`),             { reportId: REPORT_ID, status: 'unmapped' });
  batch.set(db.doc(`${venue}/salesReportRecipeMatches/rm1`),         { reportId: REPORT_ID });
  batch.set(db.doc(`${venue}/recipeSalesAttribution/ra1`),           { reportId: REPORT_ID });
  batch.set(db.doc(`${venue}/processedSalesReports/proc_by_id`),     { reportId: REPORT_ID }); // reportId field
  batch.set(db.doc(`${venue}/processedSalesReports/${FILE_HASH}`),   { lineCount: 5 });        // keyed by hash

  await batch.commit();
  log(`Seeded throwaway venue ${VENUE_ID}.`);
}

async function assertDerived(path, expectExists) {
  const snap = await db.doc(path).get();
  if (expectExists && !snap.exists) fail(`expected ${path} to exist`);
  else if (!expectExists && snap.exists) fail(`expected ${path} to be deleted, but it still exists`);
  else pass(`${expectExists ? 'exists' : 'deleted'}: ${path}`);
}

async function deleteVenue() {
  // Delete all known seeded documents + report.
  const paths = [
    `${venue}/members/${OWNER_UID}`,
    `${venue}/salesReports/${REPORT_ID}`,
    `${venue}/salesReportMatches/${REPORT_ID}`,
    `${venue}/salesReportMatches/match_auto`,
    `${venue}/salesReportUnknowns/unk1`,
    `${venue}/salesReportRecipeMatches/rm1`,
    `${venue}/recipeSalesAttribution/ra1`,
    `${venue}/processedSalesReports/proc_by_id`,
    `${venue}/processedSalesReports/${FILE_HASH}`,
  ];
  // Also delete any auditLog docs created during the void.
  const auditSnap = await db.collection(`${venue}/auditLog`).get();
  const auditPaths = auditSnap.docs.map(d => d.ref.path);

  const all = [...paths, ...auditPaths];
  const batch = db.batch();
  all.forEach(p => batch.delete(db.doc(p)));
  await batch.commit();
  log(`Deleted throwaway venue ${VENUE_ID}.`);
}

async function main() {
  await seedVenue();

  try {
    log('Running voidSalesReportLogic…');
    const result = await voidSalesReportLogic(db, VENUE_ID, REPORT_ID, OWNER_UID, 'verify run');
    log(`Result: ${JSON.stringify(result)}`);

    if (!result.ok)        fail(`voidSalesReportLogic returned ok:false — ${result.error}`);
    else if (result.alreadyVoided) fail('Got alreadyVoided:true on first run — something wrong');
    else {
      pass('ok:true, needsReenrich:true returned');

      // Assert report status.
      const reportSnap = await db.doc(`${venue}/salesReports/${REPORT_ID}`).get();
      const rData = reportSnap.data();
      if (rData?.status === 'voided')              pass('report.status === voided');
      else                                         fail(`report.status is ${rData?.status}`);
      if (rData?.voidCleanupComplete === true)     pass('voidCleanupComplete === true');
      else                                         fail('voidCleanupComplete is not true');

      // Assert derived docs deleted.
      await assertDerived(`${venue}/salesReportMatches/${REPORT_ID}`,    false);
      await assertDerived(`${venue}/salesReportMatches/match_auto`,      false);
      await assertDerived(`${venue}/salesReportUnknowns/unk1`,           false);
      await assertDerived(`${venue}/salesReportRecipeMatches/rm1`,       false);
      await assertDerived(`${venue}/recipeSalesAttribution/ra1`,         false);
      await assertDerived(`${venue}/processedSalesReports/proc_by_id`,   false);
      await assertDerived(`${venue}/processedSalesReports/${FILE_HASH}`, false);

      // Assert auditLog written.
      const auditSnap = await db.collection(`${venue}/auditLog`).get();
      if (auditSnap.size >= 1) pass(`auditLog entry written (${auditSnap.size} doc(s))`);
      else                     fail('no auditLog entry found');

      // Assert second call is a no-op.
      const second = await voidSalesReportLogic(db, VENUE_ID, REPORT_ID, OWNER_UID, 'second call');
      if (second.ok && second.alreadyVoided) pass('second call → alreadyVoided:true (no-op)');
      else                                   fail(`second call returned unexpected result: ${JSON.stringify(second)}`);
    }
  } finally {
    await deleteVenue();
  }

  if (process.exitCode === 1) {
    console.error('\n[verify-void] FAILED — see ✗ lines above.');
  } else {
    log('All assertions passed.');
  }
}

main().catch(e => {
  console.error('[verify-void] Unexpected error:', e);
  process.exit(1);
});
