/**
 * Phase 0(b) — read-only production scan for venue-level fields that
 * currently rely on changedKeys() vacuous truth.
 *
 * Run: node audit-venue-fields.js
 */
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

const TARGET_FIELDS = [
  'country',
  'gpAlertSensitivity',
  'productCategories',
  'lastFullVenueStocktakeAt',
  'lastCompletedAt',
  'cycleResetAt',
  'stocktakeActive',
  'totalStocktakesCompleted',
];

async function main() {
  const snap = await db.collection('venues').get();
  const total = snap.size;
  console.log(`\nTotal venues: ${total}\n`);

  for (const field of TARGET_FIELDS) {
    const present = [];
    const valueSet = new Set();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (field in data) {
        present.push({ id: doc.id, value: data[field] });
        const v = data[field];
        const display = v && typeof v === 'object' && v._seconds !== undefined
          ? '[timestamp]'
          : Array.isArray(v)
            ? `Array(${v.length})`
            : typeof v === 'object' && v !== null
              ? `Map(${Object.keys(v).join(',')})`
              : String(v);
        valueSet.add(display);
      }
    }

    const count = present.length;
    const pct = ((count / total) * 100).toFixed(1);
    const distinctValues = [...valueSet].slice(0, 10);
    console.log(`=== ${field} ===`);
    console.log(`  Present: ${count}/${total} (${pct}%)`);
    if (count > 0 && count <= 20) {
      for (const { id, value } of present) {
        const v = value && typeof value === 'object' && value._seconds !== undefined
          ? new Date(value._seconds * 1000).toISOString()
          : Array.isArray(value)
            ? `Array(${value.length})`
            : typeof value === 'object' && value !== null
              ? `Map(${Object.keys(value).join(',')})`
              : String(value);
        console.log(`    ${id}: ${v}`);
      }
    } else if (count > 0) {
      console.log(`  Distinct values (up to 10): ${distinctValues.join(' | ')}`);
    }
    console.log();
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
