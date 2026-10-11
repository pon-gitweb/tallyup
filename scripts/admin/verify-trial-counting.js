/**
 * Verify trial counting end-to-end.
 *
 * DRY-RUN by default (prints what it would do but writes nothing).
 * Pass --execute to actually create the throwaway venue, run the trigger
 * steps, assert the results, and delete everything on exit.
 *
 * Usage:
 *   node scripts/admin/verify-trial-counting.js           # dry-run
 *   node scripts/admin/verify-trial-counting.js --execute # live run
 *
 * The script creates a fresh venue with two departments (each with one area),
 * waits for onVenueCreated to write trialState, then adds cycles documents
 * in a sequence that exercises the full counting logic, and cleans up.
 *
 * It REFUSES to run against an existing venue id.
 * It prints PASS or FAIL for each expectation.
 * It never prints revenue figures.
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const db = new Firestore();

const EXECUTE = process.argv.includes('--execute');

// ── Throwaway-venue config ─────────────────────────────────────────────────
const OWNER_UID = '0K2BqX0MK0dSLwFx6yxt3r3T6q83';
const DEPT1_ID  = 'dept-bar';
const DEPT2_ID  = 'dept-kitchen';
const AREA1_ID  = 'area-bar-main';
const AREA2_ID  = 'area-kitchen-main';

// ── Helpers ────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, msg) { console.log(`  FAIL  ${label} — ${msg}`); }

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Poll trialState until condition returns true or timeout reached. */
async function pollTrial(venueId, condition, timeoutMs = 20000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db.doc(`venues/${venueId}/billing/trialState`).get();
    if (snap.exists && condition(snap.data())) return snap.data();
    await wait(intervalMs);
  }
  throw new Error('Timed out waiting for trialState condition');
}

/** Print current trial state (no revenue figures). */
async function printTrial(venueId) {
  const snap = await db.doc(`venues/${venueId}/billing/trialState`).get();
  if (!snap.exists) { console.log('    trialState: (not found)'); return null; }
  const d = snap.data();
  console.log(`    stocktakesUsed:        ${d.stocktakesUsed}`);
  console.log(`    status:                ${d.status}`);
  console.log(`    lastFullStocktakeAtMs: ${d.lastFullStocktakeAtMs ?? 'not set'}`);
  const seen = d.deptCycleSeenMs ?? {};
  console.log(`    deptCycleSeenMs:       ${JSON.stringify(seen)}`);
  return d;
}

function assertEq(label, actual, expected) {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!EXECUTE) {
    console.log('\n=== DRY-RUN MODE — pass --execute to actually run ===\n');
    console.log('Would create throwaway venue with:');
    console.log(`  name:      "Trial Counting Test"`);
    console.log(`  ownerUid:  ${OWNER_UID}`);
    console.log(`  venueType: venue`);
    console.log(`  departments: ${DEPT1_ID} (area: ${AREA1_ID}), ${DEPT2_ID} (area: ${AREA2_ID})`);
    console.log('\nWould run 5 cycle-event steps:');
    console.log('  Step 1: dept1 cycle (future completedAt) → expect stocktakesUsed=0');
    console.log('  Step 2: dept2 cycle → expect stocktakesUsed=1');
    console.log('  Step 3: dept1 cycle only → expect stocktakesUsed=1 (no change)');
    console.log('  Step 4: dept2 cycle → expect stocktakesUsed=2');
    console.log('  Step 5: dept1 + dept2 cycles → expect stocktakesUsed=3, status=expired');
    console.log('\nWould delete throwaway venue and all subcollections at end.');
    console.log('\nRe-run with --execute to perform the live test.\n');
    return;
  }

  console.log('\n=== EXECUTE MODE — creating throwaway venue ===\n');

  // ── Create throwaway venue ────────────────────────────────────────────────
  const venueRef = db.collection('venues').doc();
  const venueId  = venueRef.id;
  console.log(`Venue ID: ${venueId}`);

  // Safety: refuse if a document with this id already exists (extremely unlikely
  // for a fresh auto-id, but checked as a belt-and-suspenders guard).
  const existing = await venueRef.get();
  if (existing.exists) {
    console.error(`ABORT: venue ${venueId} already exists. Use a fresh run.`);
    process.exit(1);
  }

  await venueRef.set({
    name: 'Trial Counting Test',
    ownerUid: OWNER_UID,
    venueType: 'venue',
    createdAt: FieldValue.serverTimestamp(),
    totalStocktakesCompleted: 0,
  });
  console.log('Created venue doc.');

  // Create two departments, each with one area
  for (const [deptId, areaId, deptName] of [
    [DEPT1_ID, AREA1_ID, 'Bar'],
    [DEPT2_ID, AREA2_ID, 'Kitchen'],
  ]) {
    await db.doc(`venues/${venueId}/departments/${deptId}`).set({
      name: deptName,
      active: true,
      totalCyclesCompleted: 0,
    });
    await db.doc(`venues/${venueId}/departments/${deptId}/areas/${areaId}`).set({
      name: 'Main',
      startedAt: null,
      completedAt: null,
    });
  }
  console.log('Created departments and areas.');

  // ── Wait for onVenueCreated to fire and write trialState ─────────────────
  console.log('\nWaiting for onVenueCreated to write trialState...');
  try {
    await pollTrial(venueId, d => d.status === 'active', 30000);
  } catch {
    fail('onVenueCreated wrote trialState', 'timeout — is the function deployed?');
    await db.recursiveDelete(venueRef);
    process.exit(1);
  }
  pass('onVenueCreated wrote trialState with status=active');
  await printTrial(venueId);

  // ── Helper to add a cycle document ───────────────────────────────────────
  let cycleSeq = 1;
  async function addCycle(deptId, { futureCompletedAt = false } = {}) {
    const completedAt = futureCompletedAt
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year in the future
      : new Date();
    const cycleNumber = cycleSeq++;
    await db.collection(`venues/${venueId}/departments/${deptId}/cycles`).add({
      completedAt,
      cycleNumber,
      venueId,
      departmentId: deptId,
    });
    const label = futureCompletedAt ? '(future completedAt)' : '';
    console.log(`  Added cycle ${cycleNumber} for ${deptId} ${label}`);
  }

  async function waitAndPrint(label, expectedUsed, expectedStatus = 'active') {
    console.log(`\n${label}: waiting for trigger (~8s)...`);
    await wait(8000);
    const trial = await printTrial(venueId);
    assertEq(`${label}: stocktakesUsed=${expectedUsed}`, trial.stocktakesUsed, expectedUsed);
    assertEq(`${label}: status=${expectedStatus}`, trial.status, expectedStatus);

    if (expectedStatus === 'expired') {
      const venueSnap = await db.doc(`venues/${venueId}`).get();
      assertEq(`${label}: venue.trialStatus=expired`, venueSnap.data()?.trialStatus, 'expired');
    }
    return trial;
  }

  // ── Step 1: dept1 only, with FUTURE completedAt ───────────────────────────
  console.log('\n--- Step 1: dept1 cycle (future completedAt — must be ignored) ---');
  await addCycle(DEPT1_ID, { futureCompletedAt: true });
  await waitAndPrint('Step 1 (dept1 only)', 0);

  // ── Step 2: dept2 (completes the first full stocktake) ───────────────────
  console.log('\n--- Step 2: dept2 cycle ---');
  await addCycle(DEPT2_ID);
  await waitAndPrint('Step 2 (dept2 → first full)', 1);

  // ── Step 3: dept1 only (dept2 has not cycled since last count) ───────────
  console.log('\n--- Step 3: dept1 cycle only (expect no change) ---');
  await addCycle(DEPT1_ID);
  await waitAndPrint('Step 3 (dept1 only, no change)', 1);

  // ── Step 4: dept2 (second full stocktake) ────────────────────────────────
  console.log('\n--- Step 4: dept2 cycle ---');
  await addCycle(DEPT2_ID);
  await waitAndPrint('Step 4 (dept2 → second full)', 2);

  // ── Step 5: both depts (third and final — expires trial) ─────────────────
  console.log('\n--- Step 5: dept1 + dept2 cycles (expect expired) ---');
  await addCycle(DEPT1_ID);
  await addCycle(DEPT2_ID);
  await waitAndPrint('Step 5 (third full → expired)', 3, 'expired');

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log('\n--- Cleaning up throwaway venue ---');
  await db.recursiveDelete(venueRef);
  console.log(`Deleted venue ${venueId} and all subcollections.`);

  console.log('\n=== verify-trial-counting complete ===\n');
}

main().catch(e => {
  console.error('\nScript error:', e?.message ?? e);
  process.exit(1);
});
