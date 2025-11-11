// Backfill member docs for users who have a venueId but no venues/{venueId}/members/{uid}.
// Idempotent. Supports --dry-run to preview without writing.
//
// Usage:
//   node scripts/backfillMembers.cjs          # live write
//   node scripts/backfillMembers.cjs --dry-run
//
const admin = require('firebase-admin');

(function init() {
  // Use GOOGLE_APPLICATION_CREDENTIALS if present; otherwise default init (works
  // if running in a Functions env or if your env has ADC configured).
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      admin.initializeApp();
    }
  } catch (e) {
    console.error('Failed to initialize firebase-admin:', e.message);
    process.exit(1);
  }
})();

const db = admin.firestore();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} user docs`);

  let created = 0;
  let skipped = 0;
  let checked = 0;

  for (const doc of usersSnap.docs) {
    checked++;
    const uid = doc.id;
    const data = doc.data() || {};
    const venueId = data.venueId;

    if (!venueId) {
      skipped++;
      continue;
    }

    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();

    if (memberSnap.exists) {
      skipped++;
      continue;
    }

    const payload = {
      email: data.email || 'unknown@example.com',
      role: 'owner', // adjust to 'manager' for secondary accounts if needed
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (dryRun) {
      console.log(`[DRY-RUN] would create member for uid=${uid} venue=${venueId}`, payload);
      created++;
    } else {
      await memberRef.set(payload, { merge: false });
      console.log(`Created member for uid=${uid} venue=${venueId}`);
      created++;
    }
  }

  console.log(`\nChecked: ${checked} | Created: ${created} | Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
