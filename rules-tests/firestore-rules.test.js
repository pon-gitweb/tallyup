/**
 * Firestore security rules tests for salesReports and venue onboarding.
 *
 * Run via the root "test:rules" script:
 *   npm run test:rules
 *
 * Two bug areas fixed on 2026-10-09:
 *  1. salesReports create rule was too narrow (missing 5 fields added 15 Sept)
 *  2. salesReports update rule was `false` (blocking tag + supersede writes)
 *  3. Venue onboarding update missing onboardingHasSales + onboardingInvoiceLinesCount
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
//  Venue document — onboarding update
// ─────────────────────────────────────────────
describe('venue onboarding update', () => {
  // Reset venue doc before each test so affectedKeys() always reflects a real
  // field addition/change, not a no-op write to an already-set value.
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

  test('plain member CANNOT write onboardingHasSales', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ onboardingHasSales: true }));
  });

  test('manager CANNOT write subscription', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ subscription: 'pro' }));
  });

  test('manager CANNOT write subscriptionOverride', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ subscriptionOverride: 'pro' }));
  });

  test('manager CANNOT write trialStatus', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ trialStatus: 'active' }));
  });
});
