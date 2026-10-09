/**
 * Hardening tests — Step 2 (fix/rules-affectedkeys).
 *
 * These tests were EXPECTED TO FAIL on Step 1 (changedKeys gap).
 * On this branch they PASS: the gap is closed by switching venue-document
 * clauses to affectedKeys() and adding explicit rules for the 5 uncovered
 * legitimate writes (country, gpAlertSensitivity, productCategories,
 * lastFullVenueStocktakeAt) plus the global_products update tightening.
 *
 * Run via root "test:rules" script (requires Firebase emulator + Java 21).
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { Timestamp } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const VENUE_ID = 'venue-hardening';
const MEMBER_UID = 'uid-h-member';
const MANAGER_UID = 'uid-h-manager';
const OWNER_UID = 'uid-h-owner';
const GLOBAL_PRODUCT_ID = 'gp-test-001';

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

// Fresh venue doc + global product before each test.
// The security hole only fires when ADDING a new field (changedKeys() = [],
// vacuously true). A fresh doc ensures fields are absent before the test tries to
// add them.
beforeEach(async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`venues/${VENUE_ID}`).set({
      name: 'Hardening Test Venue',
      ownerUid: OWNER_UID,
    });
    await db.doc(`global_products/${GLOBAL_PRODUCT_ID}`).set({
      name: 'Test Beer',
      brand: 'Tui',
      size: '330ml',
      category: 'Beer',
      unit: 'each',
    });
  });
});

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
function asMember(uid) {
  return testEnv.authenticatedContext(uid, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'member' },
  });
}
function asSignedIn(uid) {
  return testEnv.authenticatedContext(uid);
}

function venueDoc(ctx) {
  return ctx.firestore().doc(`venues/${VENUE_ID}`);
}
function globalProductDoc(ctx) {
  return ctx.firestore().doc(`global_products/${GLOBAL_PRODUCT_ID}`);
}

// ── changedKeys gap now CLOSED ────────────────────────────────────────────────

describe('hardening: changedKeys gap (Step 2 — all PASS on Step 2 rules)', () => {
  test('plain member CANNOT add onboardingHasSales (new field)', async () => {
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

// ── Entitlement fields — denied even when absent ──────────────────────────────

describe('entitlement fields: denied even when field is absent', () => {
  test('member CANNOT add subscription', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ subscription: 'pro' }));
  });
  test('manager CANNOT add subscriptionOverride', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ subscriptionOverride: 'bypass' }));
  });
  test('owner CANNOT add subscriptionOverride', async () => {
    await assertFails(venueDoc(asOwner(OWNER_UID)).update({ subscriptionOverride: 'bypass' }));
  });
  test('member CANNOT add legacyFreeAccess', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ legacyFreeAccess: true }));
  });
  test('manager CANNOT add trialStatus', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ trialStatus: 'active' }));
  });
  test('member CANNOT add ownerUid', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ ownerUid: MEMBER_UID }));
  });
  test('owner CANNOT change ownerUid', async () => {
    await assertFails(venueDoc(asOwner(OWNER_UID)).update({ ownerUid: 'someone-else' }));
  });
  test('manager CANNOT add venueType', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ venueType: 'festival' }));
  });
});

// ── country (owner only) ──────────────────────────────────────────────────────

describe('venue country update', () => {
  test('owner CAN set country to NZ', async () => {
    await assertSucceeds(venueDoc(asOwner(OWNER_UID)).update({ country: 'NZ' }));
  });
  test('owner CAN set country to AU', async () => {
    await assertSucceeds(venueDoc(asOwner(OWNER_UID)).update({ country: 'AU' }));
  });
  test('owner CANNOT set country to invalid value (too long)', async () => {
    await assertFails(venueDoc(asOwner(OWNER_UID)).update({ country: 'New Zealand' }));
  });
  test('owner CANNOT set country to empty string', async () => {
    await assertFails(venueDoc(asOwner(OWNER_UID)).update({ country: '' }));
  });
  test('manager CANNOT update country', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ country: 'NZ' }));
  });
  test('member CANNOT update country', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ country: 'NZ' }));
  });
});

// ── gpAlertSensitivity (manager/owner, constrained values) ───────────────────

describe('venue gpAlertSensitivity update', () => {
  test('manager CAN set gpAlertSensitivity to small', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ gpAlertSensitivity: 'small' }));
  });
  test('manager CAN set gpAlertSensitivity to moderate', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ gpAlertSensitivity: 'moderate' }));
  });
  test('manager CAN set gpAlertSensitivity to significant', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ gpAlertSensitivity: 'significant' }));
  });
  test('manager CAN set gpAlertSensitivity to off', async () => {
    await assertSucceeds(venueDoc(asManager(MANAGER_UID)).update({ gpAlertSensitivity: 'off' }));
  });
  test('owner CAN set gpAlertSensitivity', async () => {
    await assertSucceeds(venueDoc(asOwner(OWNER_UID)).update({ gpAlertSensitivity: 'moderate' }));
  });
  test('manager CANNOT set gpAlertSensitivity to invalid value', async () => {
    await assertFails(venueDoc(asManager(MANAGER_UID)).update({ gpAlertSensitivity: 'high' }));
  });
  test('member CANNOT set gpAlertSensitivity', async () => {
    await assertFails(venueDoc(asMember(MEMBER_UID)).update({ gpAlertSensitivity: 'moderate' }));
  });
});

// ── productCategories (manager/owner only) ────────────────────────────────────

describe('venue productCategories update', () => {
  test('manager CAN write productCategories list', async () => {
    await assertSucceeds(
      venueDoc(asManager(MANAGER_UID)).update({ productCategories: ['Beer', 'Wine', 'Spirits'] })
    );
  });
  test('owner CAN write productCategories list', async () => {
    await assertSucceeds(
      venueDoc(asOwner(OWNER_UID)).update({ productCategories: ['Beer'] })
    );
  });
  test('member CANNOT write productCategories', async () => {
    await assertFails(
      venueDoc(asMember(MEMBER_UID)).update({ productCategories: ['Beer'] })
    );
  });
  test('manager CANNOT write productCategories as non-list', async () => {
    await assertFails(
      venueDoc(asManager(MANAGER_UID)).update({ productCategories: 'Beer' })
    );
  });
});

// ── lastFullVenueStocktakeAt (any member) ─────────────────────────────────────

describe('venue lastFullVenueStocktakeAt update', () => {
  test('member CAN set lastFullVenueStocktakeAt to a timestamp', async () => {
    await assertSucceeds(
      venueDoc(asMember(MEMBER_UID)).update({ lastFullVenueStocktakeAt: new Date() })
    );
  });
  test('manager CAN set lastFullVenueStocktakeAt', async () => {
    await assertSucceeds(
      venueDoc(asManager(MANAGER_UID)).update({ lastFullVenueStocktakeAt: new Date() })
    );
  });
  test('member CANNOT set lastFullVenueStocktakeAt to a non-timestamp', async () => {
    await assertFails(
      venueDoc(asMember(MEMBER_UID)).update({ lastFullVenueStocktakeAt: 'yesterday' })
    );
  });
});

// ── global_products update (affectedKeys + accountNumber/pricing denial) ──────

describe('global_products update', () => {
  test('signed-in user CAN update allowed field (name)', async () => {
    await assertSucceeds(
      globalProductDoc(asSignedIn(MEMBER_UID)).update({ name: 'Updated Beer', updatedAt: new Date() })
    );
  });
  test('signed-in user CAN update brand and size', async () => {
    await assertSucceeds(
      globalProductDoc(asSignedIn(MEMBER_UID)).update({ brand: 'Lion', size: '500ml' })
    );
  });
  test('signed-in user CANNOT add accountNumber (even as new field)', async () => {
    await assertFails(
      globalProductDoc(asSignedIn(MEMBER_UID)).update({ accountNumber: 'ACC123', name: 'Beer' })
    );
  });
  test('signed-in user CANNOT add pricing (even as new field)', async () => {
    await assertFails(
      globalProductDoc(asSignedIn(MEMBER_UID)).update({ pricing: { wholesale: 1.5 } })
    );
  });
  test('signed-in user CANNOT add an arbitrary unknown field', async () => {
    await assertFails(
      globalProductDoc(asSignedIn(MEMBER_UID)).update({ secretField: 'value' })
    );
  });
});
