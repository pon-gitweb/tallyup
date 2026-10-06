// backfill-trial-state.js
//
// For every venue created on/after pilotTriggerDate that has no billing/trialState,
// is not founder-owned, and does not have legacyFreeAccess, creates trialState and
// sets venue.trialStatus='active'. stocktakesAtStart is taken from the current
// totalStocktakesCompleted so existing work does not count against the trial.
//
// Usage:
//   node scripts/admin/backfill-trial-state.js            # dry run — prints candidates
//   node scripts/admin/backfill-trial-state.js --execute  # writes to Firestore

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'tallyup-f1463' });
const db = admin.firestore();

const EXECUTE = process.argv.includes('--execute');

const FOUNDER_UIDS = new Set([
  'ChpWVbutHwSCRQKr3THR79EIw1X2',
  'nIIcWSEbb2QjkKlwrALBUFXIXtu2',
  'DyydVaTSaPN5MWrLyHczVeZbzDv2',
  'XdxYqrCUeQYvfHkJkptjOoXDEwl2',
  'OIvPVgL6FpN960FMqTybe7aMRZG3',
  'WXQtR9QUsCShHtmKzopGEwiQYLV2',
]);

async function getOwnerEmail(ownerUid) {
  try {
    const userSnap = await db.doc(`users/${ownerUid}`).get();
    const email = userSnap.data()?.email;
    if (email) return email;
    const authUser = await admin.auth().getUser(ownerUid);
    return authUser.email ?? '(no email)';
  } catch {
    return '(unknown)';
  }
}

async function main() {
  const configSnap = await db.doc('config/billing').get();
  const rawTs = configSnap.data()?.pilotTriggerDate;
  if (!rawTs) throw new Error('config/billing.pilotTriggerDate not found');
  const pilotTriggerDate = rawTs.toDate();

  console.log(`pilotTriggerDate : ${pilotTriggerDate.toISOString()}`);
  console.log(`mode             : ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}\n`);

  const venuesSnap = await db.collection('venues')
    .where('createdAt', '>=', pilotTriggerDate)
    .get();

  let backfillCount = 0;
  let skippedCount  = 0;

  for (const venueDoc of venuesSnap.docs) {
    const venue   = venueDoc.data();
    const venueId = venueDoc.id;

    if (FOUNDER_UIDS.has(venue.ownerUid)) { skippedCount++; continue; }
    if (venue.legacyFreeAccess === true)   { skippedCount++; continue; }

    const trialSnap = await db.doc(`venues/${venueId}/billing/trialState`).get();
    if (trialSnap.exists) { skippedCount++; continue; }

    const createdAt        = venue.createdAt?.toDate ? venue.createdAt.toDate().toISOString() : String(venue.createdAt);
    const email            = await getOwnerEmail(venue.ownerUid);
    const stocktakesAtStart = venue.totalStocktakesCompleted ?? 0;

    console.log(`BACKFILL ${venueId} | ${venue.name} | ${createdAt} | ${email} | stocktakesAtStart:${stocktakesAtStart}`);

    if (EXECUTE) {
      const now   = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(db.doc(`venues/${venueId}/billing/trialState`), {
        startedAt:       now,
        venueCreatedAt:  venue.createdAt ?? null,
        stocktakesAtStart,
        stocktakesUsed:  0,
        status:          'active',
      });
      batch.update(db.doc(`venues/${venueId}`), { trialStatus: 'active' });
      await batch.commit();
      console.log(`  → written`);
    }

    backfillCount++;
  }

  console.log(`\nDone. Candidates: ${backfillCount}, Skipped (founder/legacy/existing): ${skippedCount}`);
  if (!EXECUTE && backfillCount > 0) {
    console.log('Run with --execute to write.');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
