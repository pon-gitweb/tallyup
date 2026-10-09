/**
 * Read-only audit: how many global_products documents contain accountNumber or pricing.
 * Run: node audit-global-products.js (from scripts/admin/ where node_modules exist)
 */
const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore();

async function main() {
  const snap = await db.collection('global_products').get();
  const total = snap.size;
  let withAccountNumber = 0;
  let withPricing = 0;
  let withEither = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const hasAN = 'accountNumber' in data;
    const hasP  = 'pricing' in data;
    if (hasAN) withAccountNumber++;
    if (hasP)  withPricing++;
    if (hasAN || hasP) withEither++;
  }
  console.log(`global_products total: ${total}`);
  console.log(`  with accountNumber:  ${withAccountNumber}`);
  console.log(`  with pricing:        ${withPricing}`);
  console.log(`  with either:         ${withEither}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
