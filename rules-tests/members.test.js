/**
 * Security rules tests for venues/{venueId}/members/{uid}
 * and venues/{venueId}/invites/{inviteId}.
 *
 * Full matrix: actor (owner / manager / staff / outsider) x operation
 * (create / update / delete) x target role (owner, manager, staff) x
 * self vs other vs primary-owner record.
 *
 * Run via root "test:rules" script (requires Firebase emulator + Java 21):
 *   PATH="$(brew --prefix openjdk@21)/bin:$PATH" JAVA_HOME="$(brew --prefix openjdk@21)" npm run test:rules
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { serverTimestamp } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const VENUE_ID         = 'venue-members-test';
const PRIMARY_OWNER_UID = 'uid-m-primary-owner';  // venue.ownerUid — protected record
const SECOND_OWNER_UID  = 'uid-m-second-owner';   // owner-role member, not primary
const MANAGER_UID       = 'uid-m-manager';
const STAFF_UID         = 'uid-m-staff';
const OUTSIDER_UID      = 'uid-m-outsider';
const INVITE_ID         = 'invite-test-1';

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

  // Seed venue doc + member docs with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`venues/${VENUE_ID}`).set({
      name: 'Members Test Venue',
      ownerUid: PRIMARY_OWNER_UID,
    });
    await db.doc(`venues/${VENUE_ID}/members/${PRIMARY_OWNER_UID}`).set({ role: 'owner' });
    await db.doc(`venues/${VENUE_ID}/members/${SECOND_OWNER_UID}`).set({ role: 'owner' });
    await db.doc(`venues/${VENUE_ID}/members/${MANAGER_UID}`).set({ role: 'manager' });
    await db.doc(`venues/${VENUE_ID}/members/${STAFF_UID}`).set({ role: 'staff' });
  });
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// ── Auth helpers ──────────────────────────────────────────────────────────────
// Use JWT claims so isVenueMember / hasVenueRole resolve via the fast token path.
// venueOwnerUid() still reads the venue doc from the emulator (seeded above).

function asPrimaryOwner() {
  return testEnv.authenticatedContext(PRIMARY_OWNER_UID, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'owner' },
  });
}
function asSecondOwner() {
  return testEnv.authenticatedContext(SECOND_OWNER_UID, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'owner' },
  });
}
function asManager() {
  return testEnv.authenticatedContext(MANAGER_UID, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'manager' },
  });
}
function asStaff() {
  return testEnv.authenticatedContext(STAFF_UID, {
    venues: { [VENUE_ID]: true },
    venue_roles: { [VENUE_ID]: 'staff' },
  });
}
function asOutsider() {
  return testEnv.authenticatedContext(OUTSIDER_UID); // no venue claims
}

function memberDoc(ctx, uid) {
  return ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`);
}
function inviteDoc(ctx, id) {
  return ctx.firestore().doc(`venues/${VENUE_ID}/invites/${id}`);
}
function inviteColl(ctx) {
  return ctx.firestore().collection(`venues/${VENUE_ID}/invites`);
}

// ─────────────────────────────────────────────
//  CREATE — bootstrap only
// ─────────────────────────────────────────────
describe('members create (bootstrap)', () => {
  test('bootstrap: primary owner creates their own member doc with role owner', async () => {
    // Use a separate venue so the doc doesn't exist yet
    const BOOT_VENUE = 'venue-bootstrap-test';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${BOOT_VENUE}`).set({ ownerUid: PRIMARY_OWNER_UID });
    });
    const ctx = testEnv.authenticatedContext(PRIMARY_OWNER_UID, {
      venues: { [BOOT_VENUE]: true },
      venue_roles: { [BOOT_VENUE]: 'owner' },
    });
    await assertSucceeds(
      ctx.firestore().doc(`venues/${BOOT_VENUE}/members/${PRIMARY_OWNER_UID}`).set({
        role: 'owner',
        email: 'owner@test.com',
        joinedAt: new Date(),
      })
    );
  });

  test('bootstrap denied: wrong role (staff instead of owner)', async () => {
    const BOOT_VENUE2 = 'venue-bootstrap-test-2';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${BOOT_VENUE2}`).set({ ownerUid: PRIMARY_OWNER_UID });
    });
    const ctx = testEnv.authenticatedContext(PRIMARY_OWNER_UID, {
      venues: { [BOOT_VENUE2]: true },
      venue_roles: { [BOOT_VENUE2]: 'owner' },
    });
    await assertFails(
      ctx.firestore().doc(`venues/${BOOT_VENUE2}/members/${PRIMARY_OWNER_UID}`).set({ role: 'staff' })
    );
  });

  test('bootstrap denied: uid is not the venue ownerUid', async () => {
    // Manager tries bootstrap path on a venue where they are not ownerUid
    const BOOT_VENUE3 = 'venue-bootstrap-test-3';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${BOOT_VENUE3}`).set({ ownerUid: PRIMARY_OWNER_UID });
    });
    const ctx = testEnv.authenticatedContext(MANAGER_UID, {
      venues: { [BOOT_VENUE3]: true },
      venue_roles: { [BOOT_VENUE3]: 'manager' },
    });
    await assertFails(
      ctx.firestore().doc(`venues/${BOOT_VENUE3}/members/${MANAGER_UID}`).set({ role: 'owner' })
    );
  });

  test('owner cannot create a member record for another uid (no owner-create path)', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), 'uid-brand-new').set({ role: 'staff' })
    );
  });

  test('manager cannot create any member record', async () => {
    await assertFails(
      memberDoc(asManager(), 'uid-brand-new').set({ role: 'staff' })
    );
  });
});

// ─────────────────────────────────────────────
//  UPDATE — owners only, role field only
// ─────────────────────────────────────────────
describe('members update', () => {
  test('owner promotes staff to manager', async () => {
    await assertSucceeds(
      memberDoc(asPrimaryOwner(), STAFF_UID).update({ role: 'manager' })
    );
    // Restore
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${STAFF_UID}`).update({ role: 'staff' });
    });
  });

  test('owner promotes non-primary owner to manager (demote second owner)', async () => {
    await assertSucceeds(
      memberDoc(asPrimaryOwner(), SECOND_OWNER_UID).update({ role: 'manager' })
    );
    // Restore
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${SECOND_OWNER_UID}`).update({ role: 'owner' });
    });
  });

  test('owner promotes staff to owner', async () => {
    await assertSucceeds(
      memberDoc(asPrimaryOwner(), STAFF_UID).update({ role: 'owner' })
    );
    // Restore
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${STAFF_UID}`).update({ role: 'staff' });
    });
  });

  test('owner changing PRIMARY owner role to manager is denied', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), PRIMARY_OWNER_UID).update({ role: 'manager' })
    );
  });

  test('owner changing PRIMARY owner role to staff is denied', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), PRIMARY_OWNER_UID).update({ role: 'staff' })
    );
  });

  test('owner keeping PRIMARY owner role as owner is allowed', async () => {
    await assertSucceeds(
      memberDoc(asPrimaryOwner(), PRIMARY_OWNER_UID).update({ role: 'owner' })
    );
  });

  test('manager sets OWN role to owner — denied', async () => {
    await assertFails(
      memberDoc(asManager(), MANAGER_UID).update({ role: 'owner' })
    );
  });

  test('manager writes role staff onto an OWNER record — denied', async () => {
    await assertFails(
      memberDoc(asManager(), PRIMARY_OWNER_UID).update({ role: 'staff' })
    );
  });

  test('manager sets staff role on staff record — denied', async () => {
    await assertFails(
      memberDoc(asManager(), STAFF_UID).update({ role: 'staff' })
    );
  });

  test('staff tries to update any role — denied', async () => {
    await assertFails(
      memberDoc(asStaff(), MANAGER_UID).update({ role: 'staff' })
    );
  });

  test('outsider tries to update — denied', async () => {
    await assertFails(
      memberDoc(asOutsider(), STAFF_UID).update({ role: 'staff' })
    );
  });

  test('owner update with extra field beyond role is denied', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), STAFF_UID).update({ role: 'manager', email: 'x@y.com' })
    );
  });

  test('owner writes role admin — denied (not in allowed set)', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), STAFF_UID).update({ role: 'admin' })
    );
  });

  test('owner writes role dev — denied (not in allowed set)', async () => {
    await assertFails(
      memberDoc(asPrimaryOwner(), STAFF_UID).update({ role: 'dev' })
    );
  });
});

// ─────────────────────────────────────────────
//  DELETE
// ─────────────────────────────────────────────
describe('members delete', () => {
  // Use separate docs so tests don't collide; restore deleted docs after each.

  test('owner deletes a staff member (non-primary record)', async () => {
    const uid = 'uid-del-staff';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'staff' });
    });
    await assertSucceeds(memberDoc(asPrimaryOwner(), uid).delete());
  });

  test('owner deletes a manager', async () => {
    const uid = 'uid-del-mgr';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'manager' });
    });
    await assertSucceeds(memberDoc(asPrimaryOwner(), uid).delete());
  });

  test('owner deletes a non-primary owner (second owner)', async () => {
    const uid = 'uid-del-owner2';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'owner' });
    });
    await assertSucceeds(memberDoc(asPrimaryOwner(), uid).delete());
  });

  // Self-leave: primary owner deletes their own record — allowed (spec §d, existing behaviour)
  test('primary owner deletes their OWN record (self-leave) — allowed', async () => {
    const uid = 'uid-del-primary-own';
    const venue = 'venue-del-primary-own';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc(`venues/${venue}`).set({ ownerUid: uid });
      await db.doc(`venues/${venue}/members/${uid}`).set({ role: 'owner' });
    });
    const ctx = testEnv.authenticatedContext(uid, {
      venues: { [venue]: true },
      venue_roles: { [venue]: 'owner' },
    });
    await assertSucceeds(ctx.firestore().doc(`venues/${venue}/members/${uid}`).delete());
  });

  // A SECOND owner cannot delete the primary owner's record
  test('second owner deletes PRIMARY owner record — denied', async () => {
    await assertFails(memberDoc(asSecondOwner(), PRIMARY_OWNER_UID).delete());
  });

  test('manager deletes a staff member — denied', async () => {
    const uid = 'uid-del-staff2';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'staff' });
    });
    await assertFails(memberDoc(asManager(), uid).delete());
  });

  test('manager deletes an owner record — denied', async () => {
    await assertFails(memberDoc(asManager(), PRIMARY_OWNER_UID).delete());
  });

  test('manager deletes themselves (self-leave) — allowed', async () => {
    const uid = 'uid-del-mgr-self';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'manager' });
    });
    const ctx = testEnv.authenticatedContext(uid, {
      venues: { [VENUE_ID]: true },
      venue_roles: { [VENUE_ID]: 'manager' },
    });
    await assertSucceeds(ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).delete());
  });

  test('staff deletes themselves (self-leave) — allowed', async () => {
    const uid = 'uid-del-staff-self';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).set({ role: 'staff' });
    });
    const ctx = testEnv.authenticatedContext(uid, {
      venues: { [VENUE_ID]: true },
      venue_roles: { [VENUE_ID]: 'staff' },
    });
    await assertSucceeds(ctx.firestore().doc(`venues/${VENUE_ID}/members/${uid}`).delete());
  });

  test('primary owner deletes themselves (self-leave) — allowed (existing behaviour)', async () => {
    // Technically allowed by the self-leave clause. UI shows "Delete project" instead,
    // but the SDK path is permitted.
    const uid = 'uid-del-primary-self';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc(`venues/venue-self-leave-test`).set({ ownerUid: uid });
      await db.doc(`venues/venue-self-leave-test/members/${uid}`).set({ role: 'owner' });
    });
    const ctx = testEnv.authenticatedContext(uid, {
      venues: { 'venue-self-leave-test': true },
      venue_roles: { 'venue-self-leave-test': 'owner' },
    });
    await assertSucceeds(ctx.firestore().doc(`venues/venue-self-leave-test/members/${uid}`).delete());
  });

  test('outsider cannot delete a member record', async () => {
    await assertFails(memberDoc(asOutsider(), STAFF_UID).delete());
  });
});

// ─────────────────────────────────────────────
//  INVITES create
// ─────────────────────────────────────────────

const VALID_INVITE_FIELDS = {
  email: 'staff@test.com',
  role: 'staff',
  status: 'pending',
  createdAt: new Date(),
};

describe('invites create', () => {
  test('owner creates a staff invite — allowed', async () => {
    await assertSucceeds(inviteColl(asPrimaryOwner()).add({ ...VALID_INVITE_FIELDS, role: 'staff' }));
  });

  test('owner creates a manager invite — allowed', async () => {
    await assertSucceeds(inviteColl(asPrimaryOwner()).add({ ...VALID_INVITE_FIELDS, role: 'manager' }));
  });

  test('owner creates an owner invite — allowed', async () => {
    await assertSucceeds(inviteColl(asPrimaryOwner()).add({ ...VALID_INVITE_FIELDS, role: 'owner' }));
  });

  test('manager creates a staff invite — allowed', async () => {
    await assertSucceeds(inviteColl(asManager()).add({ ...VALID_INVITE_FIELDS, role: 'staff' }));
  });

  test('manager creates an owner invite — denied', async () => {
    await assertFails(inviteColl(asManager()).add({ ...VALID_INVITE_FIELDS, role: 'owner' }));
  });

  test('manager creates a manager invite — denied', async () => {
    await assertFails(inviteColl(asManager()).add({ ...VALID_INVITE_FIELDS, role: 'manager' }));
  });

  test('staff creates any invite — denied', async () => {
    await assertFails(inviteColl(asStaff()).add({ ...VALID_INVITE_FIELDS, role: 'staff' }));
  });

  test('outsider creates an invite — denied', async () => {
    await assertFails(inviteColl(asOutsider()).add({ ...VALID_INVITE_FIELDS, role: 'staff' }));
  });
});

// ─────────────────────────────────────────────
//  INVITES update (role must never be changed)
// ─────────────────────────────────────────────
describe('invites update', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`venues/${VENUE_ID}/invites/${INVITE_ID}`).set({
        email: 'staff@test.com',
        role: 'staff',
        status: 'pending',
        createdAt: new Date(),
      });
    });
  });

  test('manager tries to change invite role to owner — denied', async () => {
    await assertFails(
      inviteDoc(asManager(), INVITE_ID).update({ role: 'owner' })
    );
  });

  test('owner tries to change invite role — denied (update: if false)', async () => {
    await assertFails(
      inviteDoc(asPrimaryOwner(), INVITE_ID).update({ role: 'owner' })
    );
  });

  test('owner tries to change invite status — denied (all client updates blocked)', async () => {
    await assertFails(
      inviteDoc(asPrimaryOwner(), INVITE_ID).update({ status: 'accepted' })
    );
  });
});
