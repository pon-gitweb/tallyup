/**
 * seedGlobalSuppliers.ts
 *
 * One-time script to populate the global_suppliers collection with the 13
 * canonical NZ hospitality suppliers. Safe to re-run — skips docs that exist.
 *
 * Run with:
 *   FIREBASE_PROJECT=tallyup-f1463 npx ts-node scripts/seedGlobalSuppliers.ts
 *
 * Requires application default credentials:
 *   gcloud auth application-default login
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT || 'tallyup-f1463';
const db = new Firestore({ projectId: PROJECT_ID });

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

const SEED: Array<{
  name: string; phone?: string; email?: string; website?: string; category: string;
}> = [
  { name: 'Gilmours',                          phone: '0800 454 657', website: 'https://www.gilmours.co.nz',                      category: 'food_beverage' },
  { name: 'Bidfresh',                          phone: '0800 243 373', website: 'https://www.bidfresh.co.nz',                      category: 'food_beverage' },
  { name: 'Hancocks Wine & Spirits',           phone: '0800 426 226', website: 'https://hancocks.co.nz',                          category: 'liquor'        },
  { name: 'Lion New Zealand',                  phone: '+64 9 358 9000', website: 'https://www.lion.co.nz',                        category: 'liquor'        },
  { name: 'DB Breweries',                      phone: '+64 9 579 6400', website: 'https://www.dbbreweries.co.nz',                 category: 'liquor'        },
  { name: 'Pernod Ricard Winemakers NZ',       phone: '+64 9 309 0509', website: 'https://www.pernod-ricard-nzwinemakers.com',   category: 'liquor'        },
  { name: 'Coca-Cola Europacific Partners NZ', phone: '0800 462 653',  website: 'https://www.ccep.com/en-nz',                     category: 'beverage'      },
  { name: 'Bidfood New Zealand',               phone: '0800 243 363',  website: 'https://www.bidfood.co.nz',                      category: 'food_beverage' },
  { name: 'Fresh Direct',                      phone: '+64 9 578 1234', website: 'https://www.freshdirect.co.nz',                 category: 'food_beverage' },
  { name: 'Service Foods',                     phone: '0800 737 838',  website: 'https://www.servicefoods.co.nz',                 category: 'food_beverage' },
  { name: 'Countrywide',                                               website: 'https://countrywide.co.nz',                      category: 'food_beverage' },
  { name: 'Neat Meat',                         phone: '+64 9 274 2344', website: 'https://www.neatmeat.co.nz',                   category: 'food_beverage' },
  { name: 'Open Country Dairy',                phone: '+64 7 884 6900', website: 'https://www.openctry.com',                     category: 'food_beverage' },
];

async function main() {
  console.log(`Seeding global_suppliers → project: ${PROJECT_ID}\n`);
  let added = 0;
  let skipped = 0;

  for (const s of SEED) {
    const slug = toSlug(s.name);
    const ref = db.doc(`global_suppliers/${slug}`);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        name: s.name,
        phone: s.phone ?? null,
        email: null,
        website: s.website ?? null,
        category: s.category,
        isVerified: true,
        source: 'seed',
        addedAt: FieldValue.serverTimestamp(),
      });
      console.log(`  ✓ Added:   ${s.name}  (${slug})`);
      added++;
    } else {
      console.log(`  · Exists:  ${s.name}`);
      skipped++;
    }
  }

  console.log(`\nDone: ${added} added, ${skipped} already existed (${SEED.length} total).`);
  process.exit(0);
}

main().catch(e => {
  console.error('Seed failed:', e.message || e);
  process.exit(1);
});
