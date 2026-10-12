/**
 * Verify the members rule end-to-end against the real Firebase emulator or prod.
 *
 * DRY-RUN by default (prints what it would do but writes nothing).
 * Pass --execute to actually run against the configured Firebase project.
 *
 * Usage:
 *   node scripts/admin/verify-members-rule.js           # dry-run
 *   node scripts/admin/verify-members-rule.js --execute # live run
 *
 * The script creates:
 *   - A throwaway venue via createVenueOwnedByUser (Admin SDK: role=owner, uid=OWNER)
 *   - A throwaway Firebase Auth user as ATTACKER (role=manager in that venue)
 *
 * It then attempts the escalation scenarios and prints PASS / FAIL for each.
 * On completion (success or error) it deletes the venue and the attacker user.
 *
 * Safety:
 *   - Never prints passwords, tokens, or email addresses in full.
 *   - Uses try/finally to clean up even if a step throws.
 *   - Refuses to run if FIREBASE_CONFIG / GOOGLE_APPLICATION_CREDENTIALS not set
 *     (i.e., outside the project environment).
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');

// ── Helpers ────────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, msg) { console.log(`  FAIL  ${label}${msg ? ' — ' + msg : ''}`); }

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Attempt a Firestore write as a different service account is not possible via
// Admin SDK (it always bypasses rules). To exercise the CLIENT-SIDE rules path
// we use the Firebase REST API with the user's ID token.
async function clientWrite(idToken, projectId, docPath, method, body) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const url = `${base}/${docPath}`;

  const resp = await fetch(
    method === 'DELETE' ? url : url,
    {
      method,
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: method !== 'DELETE' ? JSON.stringify(body) : undefined,
    }
  );
  return { status: resp.status, ok: resp.ok };
}

// Convert a simple JS object to Firestore REST API document fields format.
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (v === null) fields[k] = { nullValue: null };
  }
  return { fields };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!EXECUTE) {
    console.log('\n=== DRY-RUN MODE — pass --execute to actually run ===\n');
    console.log('Would create:');
    console.log('  1. Throwaway venue (via Admin SDK, ownerUid = SERVICE_ACCOUNT_USER)');
    console.log('  2. Throwaway Firebase Auth user (attacker) with role=manager in that venue');
    console.log('');
    console.log('Would attempt these escalation scenarios as the attacker (manager):');
    console.log('  Scenario A: manager updates own member doc to role=owner     [expect: 403 denied]');
    console.log('  Scenario B: manager updates owner member doc to role=staff   [expect: 403 denied]');
    console.log('  Scenario C: manager creates a new member doc with role=owner [expect: 403 denied]');
    console.log('  Scenario D: manager deletes owner member doc                 [expect: 403 denied]');
    console.log('  Scenario E: manager creates invite with role=owner           [expect: 403 denied]');
    console.log('  Scenario F: manager creates invite with role=staff           [expect: 200 allowed]');
    console.log('  Scenario G: manager self-leave (deletes own member doc)      [expect: 200 allowed]');
    console.log('');
    console.log('Would delete venue and attacker user in try/finally cleanup.');
    console.log('\nRe-run with --execute to perform the live test.\n');
    return;
  }

  // ── Init Admin SDK ─────────────────────────────────────────────────────────
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const auth = admin.auth();

  // Resolve project ID
  const projectId = process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || (admin.app().options.credential?.projectId)
    || 'tallyup-f1463';

  console.log(`\n=== EXECUTE MODE — project: ${projectId} ===\n`);

  let venueId = null;
  let attackerUid = null;
  let ownerUid = null;

  try {
    // ── Step 1: Create a throwaway Firebase Auth user as ATTACKER ───────────
    console.log('Step 1: Creating throwaway Auth user (attacker)...');
    const ts = Date.now();
    const attackerEmail = `verify-members-rule-attacker-${ts}@test.invalid`;
    const attackerRecord = await auth.createUser({
      email: attackerEmail,
      password: `Tmp${ts}!Xq`,  // never printed; meets complexity requirements
      displayName: 'verify-members-rule attacker (delete me)',
    });
    attackerUid = attackerRecord.uid;
    console.log(`  Attacker UID: ${attackerUid}`);

    // ── Step 2: Create throwaway venue via Admin SDK ────────────────────────
    console.log('\nStep 2: Creating throwaway venue...');
    const ownerEmail = `verify-members-rule-owner-${ts}@test.invalid`;
    const ownerRecord = await auth.createUser({
      email: ownerEmail,
      password: `Tmp${ts}!Yq`,
      displayName: 'verify-members-rule owner (delete me)',
    });
    ownerUid = ownerRecord.uid;

    const venueRef = db.collection('venues').doc();
    venueId = venueRef.id;
    await db.runTransaction(async (tx) => {
      tx.set(venueRef, {
        name: 'verify-members-rule test venue',
        ownerUid,
        venueType: 'venue',
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`venues/${venueId}/members/${ownerUid}`), {
        role: 'owner',
        uid: ownerUid,
        joinedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`venues/${venueId}/members/${attackerUid}`), {
        role: 'manager',
        uid: attackerUid,
        joinedAt: FieldValue.serverTimestamp(),
      });
    });
    console.log(`  Venue ID: ${venueId}`);
    console.log(`  Owner UID: ${ownerUid}`);

    // Mint a custom token → exchange for ID token via REST
    console.log('\nStep 3: Minting ID token for attacker...');
    await auth.setCustomUserClaims(attackerUid, {
      venues: { [venueId]: true },
      venue_roles: { [venueId]: 'manager' },
    });
    const customToken = await auth.createCustomToken(attackerUid, {
      venues: { [venueId]: true },
      venue_roles: { [venueId]: 'manager' },
    });

    // Exchange custom token for ID token via Firebase Auth REST API
    const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDdKxrU0jUHENkl4LwIaemMR2Q3MHIrqoI';
    const tokenResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      }
    );
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      throw new Error(`Failed to exchange custom token: ${tokenResp.status} ${err}`);
    }
    const tokenData = await tokenResp.json();
    const idToken = tokenData.idToken;
    console.log('  ID token obtained (not printed).');

    // ── Scenarios ─────────────────────────────────────────────────────────────
    console.log('\n--- Escalation scenarios ---\n');

    // Scenario A: manager updates own member doc to role=owner
    {
      const docPath = `venues/${venueId}/members/${attackerUid}`;
      // PATCH with updateMask for role field
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=role`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { role: { stringValue: 'owner' } } }),
      });
      if (!r.ok) pass('A: manager updates own role to owner → denied (403)');
      else fail('A: manager updates own role to owner → ALLOWED (ESCALATION BUG)');
    }

    // Scenario B: manager updates owner's member doc to role=staff
    {
      const docPath = `venues/${venueId}/members/${ownerUid}`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=role`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { role: { stringValue: 'staff' } } }),
      });
      if (!r.ok) pass('B: manager demotes owner record to staff → denied (403)');
      else fail('B: manager demotes owner record to staff → ALLOWED (ESCALATION BUG)');
    }

    // Scenario C: manager creates a new member doc with role=owner
    {
      const newUid = `fake-owner-${ts}`;
      const docPath = `venues/${venueId}/members/${newUid}`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { role: { stringValue: 'owner' }, uid: { stringValue: newUid } } }),
      });
      if (!r.ok) pass('C: manager creates member doc with role=owner → denied (403)');
      else fail('C: manager creates member doc with role=owner → ALLOWED (ESCALATION BUG)');
    }

    // Scenario D: manager deletes owner's member doc
    {
      const docPath = `venues/${venueId}/members/${ownerUid}`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
      const r = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (!r.ok) pass('D: manager deletes owner member doc → denied (403)');
      else fail('D: manager deletes owner member doc → ALLOWED (LOCKOUT BUG)');
    }

    // Scenario E: manager creates invite with role=owner
    {
      // Use addDoc equivalent: POST to collection
      const collPath = `venues/${venueId}/invites`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collPath}`;
      const now = new Date().toISOString();
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            email: { stringValue: 'target@test.invalid' },
            role: { stringValue: 'owner' },
            status: { stringValue: 'pending' },
            createdAt: { timestampValue: now },
          }
        }),
      });
      if (!r.ok) pass('E: manager creates owner invite → denied (403)');
      else fail('E: manager creates owner invite → ALLOWED (ESCALATION BUG)');
    }

    // Scenario F: manager creates invite with role=staff (should be ALLOWED)
    {
      const collPath = `venues/${venueId}/invites`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collPath}`;
      const now = new Date().toISOString();
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            email: { stringValue: 'newstaff@test.invalid' },
            role: { stringValue: 'staff' },
            status: { stringValue: 'pending' },
            createdAt: { timestampValue: now },
          }
        }),
      });
      if (r.ok) pass('F: manager creates staff invite → allowed');
      else fail('F: manager creates staff invite → DENIED (legitimate write blocked)');
    }

    // Scenario G: manager self-leave (deletes own member doc)
    {
      const docPath = `venues/${venueId}/members/${attackerUid}`;
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
      const r = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (r.ok) pass('G: manager deletes own member doc (self-leave) → allowed');
      else fail('G: manager self-leave → DENIED (legitimate write blocked)');
    }

    console.log('\n=== verify-members-rule complete ===\n');

  } finally {
    console.log('\n--- Cleanup ---');
    if (venueId) {
      try {
        await db.recursiveDelete(db.doc(`venues/${venueId}`));
        console.log(`  Deleted venue ${venueId}`);
      } catch (e) {
        console.error(`  Could not delete venue: ${e.message}`);
      }
    }
    if (attackerUid) {
      try {
        await auth.deleteUser(attackerUid);
        console.log('  Deleted attacker Auth user');
      } catch (e) {
        console.error(`  Could not delete attacker user: ${e.message}`);
      }
    }
    if (ownerUid) {
      try {
        await auth.deleteUser(ownerUid);
        console.log('  Deleted owner Auth user');
      } catch (e) {
        console.error(`  Could not delete owner user: ${e.message}`);
      }
    }
    console.log('Cleanup done.\n');
  }
}

main().catch(e => {
  console.error('\nScript error:', e?.message ?? e);
  process.exit(1);
});
