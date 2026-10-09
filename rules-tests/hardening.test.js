/**
 * Hardening tests — documenting the changedKeys() new-field gap.
 *
 * These tests are EXPECTED TO FAIL on fix/sales-report-rules (Step 1).
 * They represent the open security hole: changedKeys() is vacuously true
 * when adding a brand-new field, so any manager can add subscriptionOverride,
 * subscription, trialStatus etc. if the field doesn't already exist.
 *
 * The fix (affectedKeys() everywhere + full client-write audit) is on
 * fix/rules-affectedkeys (Step 2). When that branch passes these tests,
 * the hole is closed.
 *
 * Run with the root "test:rules" script (requires Firebase emulator + Java 21).
 */

const {
  initializeTestEnvironment,
  assertFails,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const VENUE_ID = 'venue-hardening';
const MEMBER_UID = 'uid-h-member';
const MANAGER_UID = 'uid-h-manager';

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
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// Fresh venue doc before each test so the target field doesn't already exist
// (the vulnerability only triggers when ADDING a new field, not changing one).
beforeEach(async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore()
      .doc(`venues/${VENUE_ID}`)
      .set({ name: 'Hardening Test Venue', ownerUid: 'uid-h-owner' });
  });
});

function asManager(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'manager' },
  });
}
function asMember(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'member' },
  });
}

function venueDoc(ctx) {
  return ctx.firestore().doc(`venues/${VENUE_ID}`);
}

// ── These SHOULD be denied but are ALLOWED on Step-1 rules (changedKeys gap) ──
// Each xtest is intentionally named "xtest" so it runs but is expected-to-fail.
// When Step 2 closes the hole, change xtest → test and they should all pass.

describe('hardening: changedKeys gap (Step 2 target — all FAIL on Step 1)', () => {
  test('plain member CANNOT add onboardingHasSales (new field)', async () => {
    // FAILS on Step 1: changedKeys() = [] for a new field; [].hasOnly([...]) is vacuously true
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ onboardingHasSales: true }));
  });

  test('manager CANNOT add subscription (new field)', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ subscription: 'pro' }));
  });

  test('manager CANNOT add subscriptionOverride (new field)', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ subscriptionOverride: 'pro' }));
  });

  test('manager CANNOT add trialStatus (new field)', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ trialStatus: 'active' }));
  });
});
