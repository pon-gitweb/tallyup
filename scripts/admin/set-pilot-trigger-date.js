// Set (or update) the config/billing Firestore document with pilotTriggerDate.
//
// Usage:
//   node scripts/admin/set-pilot-trigger-date.js [YYYY-MM-DD]
//
// If a date argument is supplied, that date is used; otherwise defaults to
// 21 days from today (the initial confirmed value per 26 Sep 2026 spec).
//
// The document is written with merge:true so other future fields are preserved.
// Safe to re-run — it simply overwrites pilotTriggerDate.

const { Firestore } = require('@google-cloud/firestore');

async function main() {
  const db = new Firestore();

  let targetDate;
  if (process.argv[2]) {
    targetDate = new Date(process.argv[2] + 'T00:00:00Z');
    if (isNaN(targetDate.getTime())) {
      console.error('Invalid date argument. Use YYYY-MM-DD format.');
      process.exit(1);
    }
  } else {
    // Default: 21 days from today
    targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + 21);
    targetDate.setUTCHours(0, 0, 0, 0);
  }

  const Timestamp = require('@google-cloud/firestore').Timestamp;
  const ts = Timestamp.fromDate(targetDate);

  await db.doc('config/billing').set({ pilotTriggerDate: ts }, { merge: true });

  console.log(`config/billing.pilotTriggerDate set to ${targetDate.toISOString().slice(0, 10)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
