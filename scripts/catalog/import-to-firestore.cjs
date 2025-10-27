const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@fast-csv/parse');
const { Firestore } = require('@google-cloud/firestore');
const { ensureSupplierSlug } = require('./utils.cjs');

const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, 'supplier_catalogs/normalized');
const DRY = String(process.env.DRY_RUN || '') === '1';
const PROJECT_ID = process.env.FIREBASE_PROJECT;

if (!PROJECT_ID) {
  console.error('FIREBASE_PROJECT env var is required');
  process.exit(1);
}

const db = new Firestore({
  projectId: PROJECT_ID,
  // GOOGLE_APPLICATION_CREDENTIALS is picked up automatically
});

// Expected headers
const HEADERS = [
  'supplier','externalSku','name','size','abv','unitsPerCase','unit',
  'priceBottleExGst','priceCaseExGst','gstPercent','category','notes'
];

// Slug for item doc ids (stable-ish without collisions for our catalogs)
const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 120);

async function importCsv(filePath) {
  const base = path.basename(filePath);
  const supplierFromFilename = base.replace(/\.csv$/i, '').replace(/-/g, ' ');
  const supplierSlug = ensureSupplierSlug(base.replace(/\.csv$/i, ''));
  const collection = db.collection('global_suppliers').doc(supplierSlug).collection('items');

  console.log(`[firestore] Importing ${base} \u2192 global_suppliers/${supplierSlug}/items`);

  let batch = db.batch();
  let writesInBatch = 0;
  let total = 0;

  async function commitAndReset() {
    if (DRY) { writesInBatch = 0; batch = db.batch(); return; }
    if (writesInBatch === 0) return;
    await batch.commit();
    batch = db.batch();
    writesInBatch = 0;
  }

  function put(row) {
    // Keep the row shape as-is (we trust the normalized CSV)
    const supplier = row.supplier || supplierFromFilename;
    const idRoot = [
      row.externalSku || '',
      row.name || '',
      row.size || '',
      row.abv || ''
    ].filter(Boolean).join('-');

    const docId = slug(idRoot) || slug(`${Date.now()}-${Math.random()}`);
    const ref = collection.doc(docId);

    const payload = {
      supplier,
      externalSku: row.externalSku || '',
      name: row.name || '',
      size: row.size || '',
      abv: row.abv ? Number(row.abv) : null,
      unitsPerCase: row.unitsPerCase ? Number(row.unitsPerCase) : null,
      unit: row.unit || '',
      priceBottleExGst: row.priceBottleExGst ? Number(row.priceBottleExGst) : null,
      priceCaseExGst: row.priceCaseExGst ? Number(row.priceCaseExGst) : null,
      gstPercent: row.gstPercent ? Number(row.gstPercent) : 15,
      category: row.category || '',
      notes: row.notes || '',
      updatedAt: new Date().toISOString()
    };

    if (!DRY) batch.set(ref, payload, { merge: true });
    writesInBatch++;
    total++;
  }

  // Stream + parse with header validation
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
      .pipe(parse({ headers: HEADERS, strictColumnHandling: true, ignoreEmpty: true, trim: true }))
      .on('error', reject)
      .on('data', async (row) => {
        put(row);
        // Commit when we approach the 500 op limit
        if (writesInBatch >= 450) {
          stream.pause();
          commitAndReset()
            .then(() => stream.resume())
            .catch(reject);
        }
      })
      .on('end', async () => {
        try {
          await commitAndReset(); // final flush
          const tag = DRY ? '[DRY RUN] ' : '';
          console.log(`[firestore] ${base}: ${tag}Imported ${total} rows.`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
  });
}

(async function run() {
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv')).sort();
  for (const f of files) {
    await importCsv(path.join(CSV_DIR, f));
  }
  console.log('Done.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
