/**
 * Firestore security rules tests — core covered-write shapes.
 *
 * Run via the root "test:rules" script:
 *   npm run test:rules
 *
 * Covers salesReports create/update and venue onboarding.
 * The affectedKeys() hardening and new field clauses are tested in hardening.test.js.
 *
 * Auth strategy: pass custom JWT claims that match the real app's token shape
 * (`venues` + `venue_roles`), so `isVenueMember` / `hasVenueRole` use the
 * token path and don't trigger the `get()` path inside the emulator.
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const VENUE_ID = 'venue-abc';
const MEMBER_UID = 'uid-member';
const MANAGER_UID = 'uid-manager';
const OWNER_UID = 'uid-owner';
const OUTSIDER_UID = 'uid-outsider';
const REPORT_ID = 'report-1';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-tallyup',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });

  // Seed fixture data with security rules disabled.
  // No clearFirestore() between tests — we rely on unique IDs where isolation
  // matters (create tests use add() which auto-generates IDs).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Venue document — required for onboarding update tests
    await db.doc(`venues/${VENUE_ID}`).set({ name: 'Test Venue', ownerUid: OWNER_UID });
    // salesReport document — target for update tests
    await db.doc(`venues/${VENUE_ID}/salesReports/${REPORT_ID}`).set({
      source: 'csv',
      report: { rows: [] },
      periodStart: null,
      periodEnd: null,
      overlappingCycles: [],
      allocationMethod: 'none',
      status: 'active',
      createdAt: new Date(),
    });
  });
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// Auth helpers — pass custom claims that match the real Firebase Auth token shape:
//   venues[venueId] = true  →  isVenueMember() token branch
//   venue_roles[venueId]    →  hasVenueRole() token branch
function asMember(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'member' },
  });
}
function asManager(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'manager' },
  });
}
function asOwner(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'owner' },
  });
}
function asOutsider(uid) {
  return testEnv.authenticatedContext(uid); // no venue claim
}

function salesReports(ctx) {
  return ctx.firestore().collection(`venues/${VENUE_ID}/salesReports`);
}
function reportDoc(ctx) {
  return ctx.firestore().doc(`venues/${VENUE_ID}/salesReports/${REPORT_ID}`);
}
function venueDoc(ctx) {
  return ctx.firestore().doc(`venues/${VENUE_ID}`);
}

// ─────────────────────────────────────────────
//  salesReports — CREATE
// ─────────────────────────────────────────────
describe('salesReports create', () => {
  const FULL_PAYLOAD = {
    source: 'csv',
    report: { rows: [] },
    periodStart: null,
    periodEnd: null,
    overlappingCycles: [],
    allocationMethod: 'none',
    status: 'active',
    createdAt: new Date(),
  };

  test('member can create with all 8 required fields', async () => {
    await assertSucceeds(salesReports(asMember(MEMBER_UID)).add(FULL_PAYLOAD));
  });

  test('manager can create with all 8 required fields', async () => {
    await assertSucceeds(salesReports(asManager(MANAGER_UID)).add(FULL_PAYLOAD));
  });

  test('create is denied with an extra unknown field', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({ ...FULL_PAYLOAD, hackerField: 'evil' })
    );
  });

  test('create is denied with wrong status value', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({ ...FULL_PAYLOAD, status: 'superseded' })
    );
  });

  test('create is denied with wrong allocationMethod value', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({ ...FULL_PAYLOAD, allocationMethod: 'exact_single_cycle' })
    );
  });

  test('create is denied for outsider (not a venue member)', async () => {
    await assertFails(salesReports(asOutsider(OUTSIDER_UID)).add(FULL_PAYLOAD));
  });
});

// ─────────────────────────────────────────────
//  salesReports — UPDATE (shape A: tag overlapping cycles)
// ─────────────────────────────────────────────
describe('salesReports update — tag overlapping cycles', () => {
  test('member can update overlappingCycles + allocationMethod', async () => {
    await assertSucceeds(
      reportDoc(asMember(MEMBER_UID)).update({
        overlappingCycles: [{ departmentId: 'd1', cycleNumber: 1, weight: 0.5 }],
        allocationMethod: 'exact_single_cycle',
      })
    );
  });

  test('manager can update overlappingCycles + allocationMethod', async () => {
    await assertSucceeds(
      reportDoc(asManager(MANAGER_UID)).update({
        overlappingCycles: [],
        allocationMethod: 'none',
      })
    );
  });

  test('outsider cannot update overlappingCycles', async () => {
    await assertFails(
      reportDoc(asOutsider(OUTSIDER_UID)).update({
        overlappingCycles: [],
        allocationMethod: 'none',
      })
    );
  });
});

// ─────────────────────────────────────────────
//  salesReports — UPDATE (shape B: supersede)
// ─────────────────────────────────────────────
describe('salesReports update — supersede', () => {
  test('member can update status + supersededBy + supersededAt', async () => {
    await assertSucceeds(
      reportDoc(asMember(MEMBER_UID)).update({
        status: 'superseded',
        supersededBy: 'report-2',
        supersededAt: new Date(),
      })
    );
  });

  test('update with wrong status value is denied', async () => {
    await assertFails(
      reportDoc(asMember(MEMBER_UID)).update({
        status: 'active',
        supersededBy: 'report-2',
        supersededAt: new Date(),
      })
    );
  });

  test('update that changes report field is denied (extra key)', async () => {
    await assertFails(
      reportDoc(asMember(MEMBER_UID)).update({
        report: { rows: [1, 2, 3] },
      })
    );
  });
});

// ─────────────────────────────────────────────
//  salesReports — CREATE: report.meta placement
// ─────────────────────────────────────────────
describe('salesReports create — report.meta placement', () => {
  const BASE_PAYLOAD = {
    source: 'csv',
    periodStart: null,
    periodEnd: null,
    overlappingCycles: [],
    allocationMethod: 'none',
    status: 'active',
    createdAt: new Date(),
  };

  test('create with metadata inside report.meta is ALLOWED', async () => {
    await assertSucceeds(
      salesReports(asMember(MEMBER_UID)).add({
        ...BASE_PAYLOAD,
        report: {
          lines: [],
          lineCount: 0,
          importedFrom: 'desktop',
          meta: {
            sourceFormat: 'bustle_items',
            parserVersion: 2,
            lineTotalsBasis: 'line_total',
            gstBasis: 'assumed_incl',
            kind: 'items',
            reportTotals: null,
            categoryTotals: null,
            fileHash: null,
          },
        },
      })
    );
  });

  test('create with top-level sourceFormat field is DENIED', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({
        ...BASE_PAYLOAD,
        report: { lines: [], lineCount: 0 },
        sourceFormat: 'bustle_items',
      })
    );
  });

  test('create with top-level parserVersion field is DENIED', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({
        ...BASE_PAYLOAD,
        report: { lines: [], lineCount: 0 },
        parserVersion: 2,
      })
    );
  });

  test('create with top-level gstBasis field is DENIED', async () => {
    await assertFails(
      salesReports(asMember(MEMBER_UID)).add({
        ...BASE_PAYLOAD,
        report: { lines: [], lineCount: 0 },
        gstBasis: 'assumed_incl',
      })
    );
  });
});

// ─────────────────────────────────────────────
//  Venue document — onboarding update
// ─────────────────────────────────────────────
describe('venue onboarding update', () => {
  // Reset venue doc before each test so the write always reflects a real field
  // addition/change, not a no-op write to an already-set value.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`venues/${VENUE_ID}`)
        .set({ name: 'Test Venue', ownerUid: OWNER_UID });
    });
  });

  test('manager can write onboardingHasSales', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ onboardingHasSales: true }));
  });

  test('owner can write onboardingHasSales', async () => {
    await assertSucceeds(venueDoc(asOwner(OWNER_UID)).update({ onboardingHasSales: false }));
  });

  test('manager can write onboardingInvoiceLinesCount', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ onboardingInvoiceLinesCount: 42 }));
  });

  test('owner can write both onboarding fields together', async () => {
    await assertSucceeds(
      venueDoc(asOwner(OWNER_UID)).update({
        onboardingHasSales: true,
        onboardingInvoiceLinesCount: 100,
      })
    );
  });

});

// ─────────────────────────────────────────────
//  snapshots/itemChunks subcollection access
// ─────────────────────────────────────────────
describe('snapshots itemChunks access', () => {
  const DEPT_ID = 'dept-rules-test';
  const SNAP_ID = 'cycle-1';
  const CHUNK_ID = '000';

  function chunkDoc(ctx) {
    return ctx.firestore().doc(
      `venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}/itemChunks/${CHUNK_ID}`
    );
  }

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore()
        .doc(`venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}/itemChunks/${CHUNK_ID}`)
        .set({ index: 0, items: [] });
    });
  });

  test('member can write an itemChunks doc', async () => {
    await assertSucceeds(chunkDoc(asMember(MEMBER_UID)).set({ index: 0, items: [] }));
  });

  test('member can read an itemChunks doc', async () => {
    await assertSucceeds(chunkDoc(asMember(MEMBER_UID)).get());
  });

  test('non-member cannot read an itemChunks doc', async () => {
    await assertFails(chunkDoc(asOutsider(OUTSIDER_UID)).get());
  });

  test('non-member cannot write an itemChunks doc', async () => {
    await assertFails(chunkDoc(asOutsider(OUTSIDER_UID)).set({ index: 0, items: [] }));
  });

  test('member batch-writing snapshot + 3 chunk docs succeeds', async () => {
    const memberDb = asMember(MEMBER_UID).firestore();
    const batch = memberDb.batch();
    batch.set(memberDb.doc(`venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}`), { cycleNumber: 1, itemChunkCount: 3 });
    batch.set(memberDb.doc(`venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}/itemChunks/000`), { index: 0, items: [] });
    batch.set(memberDb.doc(`venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}/itemChunks/001`), { index: 1, items: [] });
    batch.set(memberDb.doc(`venues/${VENUE_ID}/departments/${DEPT_ID}/snapshots/${SNAP_ID}/itemChunks/002`), { index: 2, items: [] });
    await assertSucceeds(batch.commit());
  });
});
// Full hardening coverage (new-field gap, entitlement denial, country, gpAlertSensitivity,
// productCategories, lastFullVenueStocktakeAt, global_products) is in hardening.test.js.

// ─────────────────────────────────────────────
//  supplierRegistrations — closed feature gate
// ─────────────────────────────────────────────
const ADMIN_EMAIL = 'poni@hosti.co.nz';
const REG_PAYLOAD = { companyName: 'Acme', email: 'acme@example.com', status: 'pending' };

function asAdmin() {
  return testEnv.authenticatedContext('uid-admin', { email: ADMIN_EMAIL });
}
function asNonAdmin() {
  return testEnv.authenticatedContext('uid-nonadmin', { email: 'other@example.com' });
}

describe('supplierRegistrations — create denied (registration closed)', () => {
  test('unauthenticated create is denied', async () => {
    await assertFails(
      testEnv.unauthenticatedContext().firestore().collection('supplierRegistrations').add(REG_PAYLOAD)
    );
  });

  test('authenticated non-admin create is denied', async () => {
    await assertFails(
      asNonAdmin().firestore().collection('supplierRegistrations').add(REG_PAYLOAD)
    );
  });
});

describe('supplierRegistrations — read access', () => {
  const REG_ID = 'reg-seed-1';

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`supplierRegistrations/${REG_ID}`).set(REG_PAYLOAD);
    });
  });

  test('admin (poni@hosti.co.nz) can read a registration', async () => {
    await assertSucceeds(
      asAdmin().firestore().doc(`supplierRegistrations/${REG_ID}`).get()
    );
  });

  test('non-admin read is denied', async () => {
    await assertFails(
      asNonAdmin().firestore().doc(`supplierRegistrations/${REG_ID}`).get()
    );
  });
});
