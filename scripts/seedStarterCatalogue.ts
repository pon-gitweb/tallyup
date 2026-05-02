/**
 * seedStarterCatalogue.ts
 *
 * Seeds a "Hosti-Stock Starter Catalogue" into the global_suppliers Firestore
 * collection so new venues have something to browse in the Supplier Catalogues modal.
 *
 * Run with:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   FIREBASE_PROJECT=tallyup-f1463 \
 *   npx ts-node scripts/seedStarterCatalogue.ts
 *
 * Or using the functions service account:
 *   cd functions && npm run build && cd ..
 *   FIREBASE_PROJECT=tallyup-f1463 npx ts-node scripts/seedStarterCatalogue.ts
 *
 * Prereqs:  npm install -g ts-node typescript  (or use npx)
 *           @google-cloud/firestore must be accessible (it's in functions/node_modules)
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT || 'tallyup-f1463';

const db = new Firestore({ projectId: PROJECT_ID });

const SUPPLIER_ID = 'hosti-stock-starter';
const SUPPLIER_NAME = 'Hosti-Stock Starter Catalogue';

interface CatalogItem {
  name: string;
  size: string;
  unit: string;
  category: string;
  abv?: number;
  unitsPerCase?: number;
  priceBottleExGst?: number;
  gstPercent: number;
}

const ITEMS: CatalogItem[] = [
  // ── Spirits ───────────────────────────────────────────────────────────────
  { name: 'Premium Vodka',         size: '1L',    unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 42 },
  { name: 'Premium Vodka',         size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 32 },
  { name: 'London Dry Gin',        size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 38 },
  { name: 'London Dry Gin',        size: '1L',    unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 48 },
  { name: 'Blended Scotch Whisky', size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 36 },
  { name: 'Blended Scotch Whisky', size: '1L',    unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 46 },
  { name: 'Bourbon Whiskey',       size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 40 },
  { name: 'Dark Rum',              size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 30 },
  { name: 'White Rum',             size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 28 },
  { name: 'Spiced Rum',            size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 34 },
  { name: 'Silver Tequila',        size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 44 },
  { name: 'Gold Tequila',          size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 48 },
  { name: 'Triple Sec Liqueur',    size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 26 },
  { name: 'Coffee Liqueur',        size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 30 },
  { name: 'Aperol',                size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 28 },
  { name: 'Campari',               size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 32 },
  { name: 'Dry Vermouth',          size: '750ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 16 },
  { name: 'Sweet Vermouth',        size: '750ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 18 },
  { name: 'Single Malt Whisky',    size: '700ml', unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 65 },
  { name: 'Vodka Miniatures',      size: '50ml',  unit: 'bottle', category: 'spirits', gstPercent: 15, priceBottleExGst: 4, unitsPerCase: 24 },

  // ── Wine ──────────────────────────────────────────────────────────────────
  { name: 'Sauvignon Blanc',       size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 14, abv: 12.5 },
  { name: 'Pinot Gris',            size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 15, abv: 13 },
  { name: 'Chardonnay',            size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 16, abv: 13 },
  { name: 'Riesling',              size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 15, abv: 11 },
  { name: 'Rosé',                  size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 14, abv: 12 },
  { name: 'Pinot Noir',            size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 18, abv: 13.5 },
  { name: 'Merlot',                size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 15, abv: 13 },
  { name: 'Cabernet Sauvignon',    size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 17, abv: 14 },
  { name: 'Sparkling Wine',        size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 16, abv: 11.5 },
  { name: 'Prosecco',              size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 18, abv: 11 },
  { name: 'Sauvignon Blanc',       size: '1.5L',  unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 26, abv: 12.5 },
  { name: 'House Red Wine',        size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 10, abv: 13 },
  { name: 'House White Wine',      size: '750ml', unit: 'bottle', category: 'wine', gstPercent: 15, priceBottleExGst: 10, abv: 12.5 },

  // ── Beer & Cider ──────────────────────────────────────────────────────────
  { name: 'Lager Bottles',         size: '330ml', unit: 'bottle', category: 'beer', gstPercent: 15, priceBottleExGst: 2.8, unitsPerCase: 24 },
  { name: 'Lager Bottles',         size: '500ml', unit: 'bottle', category: 'beer', gstPercent: 15, priceBottleExGst: 3.5, unitsPerCase: 12 },
  { name: 'IPA Bottles',           size: '330ml', unit: 'bottle', category: 'beer', gstPercent: 15, priceBottleExGst: 3.2, abv: 6, unitsPerCase: 24 },
  { name: 'Pale Ale Bottles',      size: '330ml', unit: 'bottle', category: 'beer', gstPercent: 15, priceBottleExGst: 3.0, abv: 4.5, unitsPerCase: 24 },
  { name: 'Stout Cans',            size: '440ml', unit: 'can',    category: 'beer', gstPercent: 15, priceBottleExGst: 3.2, abv: 4.2, unitsPerCase: 24 },
  { name: 'Lager Cans',            size: '330ml', unit: 'can',    category: 'beer', gstPercent: 15, priceBottleExGst: 2.5, unitsPerCase: 24 },
  { name: 'Apple Cider Bottles',   size: '330ml', unit: 'bottle', category: 'cider', gstPercent: 15, priceBottleExGst: 3.0, abv: 4, unitsPerCase: 24 },
  { name: 'Pear Cider Bottles',    size: '330ml', unit: 'bottle', category: 'cider', gstPercent: 15, priceBottleExGst: 3.0, abv: 4, unitsPerCase: 24 },
  { name: 'Non-Alcoholic Beer',    size: '330ml', unit: 'bottle', category: 'beer', gstPercent: 15, priceBottleExGst: 2.5, unitsPerCase: 24 },
  { name: 'Beer Keg (Lager)',      size: '50L',   unit: 'keg',    category: 'beer', gstPercent: 15, priceBottleExGst: 160 },
  { name: 'Beer Keg (Pale Ale)',   size: '30L',   unit: 'keg',    category: 'beer', gstPercent: 15, priceBottleExGst: 120 },

  // ── Non-Alcoholic ─────────────────────────────────────────────────────────
  { name: 'Cola',                  size: '300ml', unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.2, unitsPerCase: 24 },
  { name: 'Diet Cola',             size: '300ml', unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.2, unitsPerCase: 24 },
  { name: 'Lemon Lime & Bitters',  size: '300ml', unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.2, unitsPerCase: 24 },
  { name: 'Ginger Beer',           size: '330ml', unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.8, unitsPerCase: 24 },
  { name: 'Soda Water',            size: '750ml', unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 2.5 },
  { name: 'Tonic Water',           size: '200ml', unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.4, unitsPerCase: 24 },
  { name: 'Orange Juice',          size: '1L',    unit: 'carton', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 3.5 },
  { name: 'Cranberry Juice',       size: '1L',    unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 4.0 },
  { name: 'Pineapple Juice',       size: '1L',    unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 3.2 },
  { name: 'Tomato Juice',          size: '1L',    unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 3.5 },
  { name: 'Coconut Water',         size: '1L',    unit: 'carton', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 4.5 },
  { name: 'Still Water',           size: '600ml', unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 1.2, unitsPerCase: 24 },
  { name: 'Sparkling Water',       size: '750ml', unit: 'bottle', category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 2.0 },
  { name: 'Energy Drink',          size: '250ml', unit: 'can',    category: 'non-alcoholic', gstPercent: 15, priceBottleExGst: 2.5, unitsPerCase: 24 },

  // ── Bar Supplies / Mixers ─────────────────────────────────────────────────
  { name: 'Lime Juice',            size: '1L',    unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 8.0 },
  { name: 'Lemon Juice',           size: '1L',    unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 8.0 },
  { name: 'Grenadine',             size: '700ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 9.0 },
  { name: 'Simple Syrup',          size: '750ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 7.0 },
  { name: 'Angostura Bitters',     size: '200ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 12.0 },
  { name: 'Orange Bitters',        size: '100ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 10.0 },
  { name: 'Coconut Cream',         size: '400ml', unit: 'can',    category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 3.5 },
  { name: 'Blue Curaçao',          size: '700ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 20.0 },
  { name: 'Elderflower Cordial',   size: '500ml', unit: 'bottle', category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 6.0 },
  { name: 'Cocktail Olives',       size: '450g',  unit: 'jar',    category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 6.5 },
  { name: 'Maraschino Cherries',   size: '450g',  unit: 'jar',    category: 'bar-supplies', gstPercent: 15, priceBottleExGst: 7.0 },
];

async function seed() {
  console.log(`\n🌱  Seeding "${SUPPLIER_NAME}" (${ITEMS.length} items) → ${PROJECT_ID}\n`);

  const supRef = db.collection('global_suppliers').doc(SUPPLIER_ID);

  // Write the supplier document
  await supRef.set({
    name: SUPPLIER_NAME,
    source: 'starter-seed',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`✔  Supplier doc written: global_suppliers/${SUPPLIER_ID}`);

  // Write each item into the items subcollection
  const itemsCol = supRef.collection('items');
  let written = 0;
  for (const item of ITEMS) {
    const slug = `${item.name}-${item.size}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    await itemsCol.doc(slug).set({
      ...item,
      supplier: SUPPLIER_NAME,
      updatedAt: FieldValue.serverTimestamp(),
    });
    written++;
    process.stdout.write(`\r  Writing items… ${written}/${ITEMS.length}`);
  }

  console.log(`\n\n✅  Done. ${written} items written to global_suppliers/${SUPPLIER_ID}/items`);
  console.log(`\n   Open the app → Add Products → From a supplier catalogue`);
  console.log(`   "${SUPPLIER_NAME}" should now appear in the list.\n`);
}

seed().catch(err => {
  console.error('\n❌  Seed failed:', err.message || err);
  process.exit(1);
});
