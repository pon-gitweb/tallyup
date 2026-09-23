// Backfill missing email on owner member documents.
//
// Root cause: CreateVenueScreen.tsx historically wrote members/{uid} with only
// { role: 'owner', createdAt } — email was never included. This affects every
// venue created before the fix. This script finds every case and writes the
// real email from Firebase Auth back to the member document.
//
// DRY RUN by default — prints every affected document and the email it would
// write. Pass --execute to apply.
//
// Usage:
//   node scripts/admin/backfill-owner-email.js            # dry-run, all venues
//   node scripts/admin/backfill-owner-email.js --execute  # write fixes

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'tallyup-f1463' });
const db    = admin.firestore();
const auth  = admin.auth();

async function main() {
  const args    = process.argv.slice(2);
  const execute = args.includes('--execute');

  const modeLabel = execute
    ? '⚠️  EXECUTE MODE — writes WILL be made.'
    : 'DRY RUN — no writes. Pass --execute to apply.';

  console.log(`\n${'─'.repeat(60)}`);
  console.log(modeLabel);
  console.log('Scanning ALL venues for owner members missing email…');
  console.log(`${'─'.repeat(60)}\n`);

  const venuesSnap = await db.collection('venues').get();
  console.log(`Found ${venuesSnap.size} venue(s).\n`);

  const affected = []; // { venueId, venueName, uid, currentEmail, resolvedEmail, ref }
  const errors   = []; // { venueId, uid, reason }

  for (const venueDoc of venuesSnap.docs) {
    const venueId   = venueDoc.id;
    const venueName = venueDoc.data().name || venueId;

    const membersSnap = await db
      .collection(`venues/${venueId}/members`)
      .where('role', '==', 'owner')
      .get();

    for (const memberDoc of membersSnap.docs) {
      const uid  = memberDoc.id;
      const data = memberDoc.data();
      const currentEmail = data.email ?? null;

      // Only backfill if email is genuinely missing (null, undefined, or empty)
      if (currentEmail && currentEmail.trim() !== '') continue;

      // Resolve email from Firebase Auth
      let resolvedEmail = null;
      try {
        const userRecord = await auth.getUser(uid);
        resolvedEmail = userRecord.email ?? null;
      } catch (e) {
        errors.push({ venueId, venueName, uid, reason: e.message || String(e) });
        continue;
      }

      if (!resolvedEmail) {
        errors.push({ venueId, venueName, uid, reason: 'Auth user has no email set' });
        continue;
      }

      affected.push({
        venueId,
        venueName,
        uid,
        currentEmail,
        resolvedEmail,
        ref: memberDoc.ref,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  if (affected.length === 0 && errors.length === 0) {
    console.log('✅ No owner member documents missing email found.\n');
    return;
  }

  if (affected.length > 0) {
    console.log(`Found ${affected.length} owner member document(s) to update:\n`);
    for (const item of affected) {
      console.log(`  📄 venues/${item.venueId}/members/${item.uid}`);
      console.log(`     Venue:          ${item.venueName}`);
      console.log(`     UID:            ${item.uid}`);
      console.log(`     email (now):    ${item.currentEmail === null ? '(null/missing)' : `"${item.currentEmail}"`}`);
      console.log(`     email (to set): "${item.resolvedEmail}"`);
      console.log('');
    }
  }

  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} owner(s) skipped (could not resolve email):\n`);
    for (const e of errors) {
      console.log(`  ⚠️  venues/${e.venueId}/members/${e.uid}  (${e.venueName})`);
      console.log(`     Reason: ${e.reason}`);
      console.log('');
    }
  }

  if (!execute) {
    console.log('─'.repeat(60));
    console.log('DRY RUN complete — no writes made.');
    if (affected.length > 0) {
      console.log(`Re-run with --execute to write email to ${affected.length} document(s).`);
    }
    console.log('─'.repeat(60));
    return;
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log('Applying fixes…\n');

  let written = 0;
  let skipped = 0;

  for (const item of affected) {
    // Re-fetch to guard against a concurrent write that already filled email
    const fresh = await item.ref.get();
    if (!fresh.exists) {
      console.log(`  ⏭  SKIP (document no longer exists): ${item.ref.path}`);
      skipped++;
      continue;
    }
    const freshEmail = fresh.data()?.email ?? null;
    if (freshEmail && freshEmail.trim() !== '') {
      console.log(`  ⏭  SKIP (email already set since scan): ${item.ref.path}  →  "${freshEmail}"`);
      skipped++;
      continue;
    }

    await item.ref.update({ email: item.resolvedEmail });
    console.log(`  ✅ UPDATED: ${item.ref.path}`);
    console.log(`     email: (null/missing) → "${item.resolvedEmail}"`);
    console.log('');
    written++;
  }

  console.log('─'.repeat(60));
  console.log(`Done. ${written} updated, ${skipped} skipped.`);
  if (errors.length > 0) {
    console.log(`${errors.length} could not be resolved (see warnings above).`);
  }
  console.log('─'.repeat(60));
  console.log('');
}

main().catch(e => {
  console.error('❌ Script failed:', e);
  process.exit(1);
});
