#!/usr/bin/env node
/**
 * Read-only dry-run: preview what the mapping-conversion logic would do to a
 * venue's sales data without writing anything to Firestore.
 *
 * Usage:
 *   node scripts/admin/preview-mapping-conversion.js --venue <venueId>
 *
 * Prerequisites:
 *   npm --prefix functions run build   (compiles functions/src → functions/lib)
 *   GOOGLE_APPLICATION_CREDENTIALS set, or run from a machine with ADC configured
 *
 * Exits non-zero on any write attempt.
 */

'use strict';

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const venueIdx = args.indexOf('--venue');
const venueId = venueIdx >= 0 ? args[venueIdx + 1] : null;

if (!venueId) {
  console.error('Usage: node scripts/admin/preview-mapping-conversion.js --venue <venueId>');
  process.exit(1);
}

// ── Load firebase-admin ──────────────────────────────────────────────────────
const path = require('path');
const admin = require(path.join(__dirname, '../../functions/node_modules/firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ── Read-only guard: patch write methods on Firestore classes ────────────────
// Capture constructors from live instances before any patching.
const DocumentReference = db.doc('__guard__/x').constructor;
const CollectionReference = db.collection('__guard__').constructor;
const WriteBatch = db.batch().constructor;
const FirestoreClass = db.constructor;

function readOnlyError() {
  throw new Error('READ-ONLY: write attempted');
}

['set', 'update', 'delete', 'create'].forEach(m => {
  DocumentReference.prototype[m] = readOnlyError;
});
CollectionReference.prototype.add = readOnlyError;
WriteBatch.prototype.commit = readOnlyError;
['runTransaction', 'batch', 'bulkWriter'].forEach(m => {
  if (typeof FirestoreClass.prototype[m] === 'function') {
    FirestoreClass.prototype[m] = readOnlyError;
  }
});

// ── Self-check: confirm the guard fires before doing anything else ────────────
(function selfCheck() {
  let threw = false;
  try {
    db.doc('__readonly_probe__/x').set({});
  } catch (e) {
    if (e?.message?.includes('READ-ONLY')) threw = true;
  }
  if (!threw) {
    console.error('FATAL: read-only guard did not activate — aborting.');
    process.exit(1);
  }
  console.log('✓ Read-only guard active.');
})();

// ── Load compiled pure functions ─────────────────────────────────────────────
const functionsLib = path.join(__dirname, '../../functions/lib');
const { classifySalesLines, buildProductIndex } = require(path.join(functionsLib, 'classifySalesLines'));
const { partitionReports } = require(path.join(functionsLib, 'weeklyLedger'));

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== preview-mapping-conversion: venue ${venueId} ===\n`);

  // ── Load products ──────────────────────────────────────────────────────────
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const productById = {};
  productsSnap.forEach(d => { productById[d.id] = { id: d.id, ...d.data() }; });
  const allProducts = Object.values(productById);
  console.log(`Products: ${allProducts.length}`);

  const productIndex = buildProductIndex(allProducts);

  // ── Load mappings ──────────────────────────────────────────────────────────
  const mappingsSnap = await db.collection(`venues/${venueId}/posProductMappings`).get();
  const fullMappings = {};
  const confirmedMappings = {};
  mappingsSnap.forEach(d => {
    const data = d.data();
    const key = (data.posItemName ?? '').toLowerCase();
    if (!key) return;
    fullMappings[key] = { id: d.id, ...data };
    if (data.productId && !data.recipeId && data.mappingType !== 'skipped') {
      confirmedMappings[key] = data.productId;
    }
  });
  console.log(`Mappings: ${Object.keys(fullMappings).length}`);

  // ── Load recipes referenced by any mapping ────────────────────────────────
  const neededRecipeIds = new Set(
    Object.values(fullMappings)
      .map(m => m.recipeId)
      .filter(Boolean),
  );
  const recipesById = {};
  await Promise.all([...neededRecipeIds].map(async (recipeId) => {
    try {
      const snap = await db.doc(`venues/${venueId}/recipes/${recipeId}`).get();
      recipesById[recipeId] = snap.exists ? snap.data() : null;
      if (!snap.exists) console.warn(`  recipe missing: ${recipeId}`);
    } catch (e) {
      recipesById[recipeId] = null;
      console.warn(`  recipe load error: ${recipeId}:`, e?.message);
    }
  }));
  console.log(`Recipes loaded: ${Object.values(recipesById).filter(Boolean).length} / ${neededRecipeIds.size} referenced`);

  // ── Load active sales reports (last 4 complete weeks) ──────────────────────
  const reportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
  const { reports: activeReports } = partitionReports(reportsSnap.docs);

  const recentReports = activeReports
    .filter(r => r.startStr)
    .sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
    .slice(0, 4);

  console.log(`\nSimulating re-match of last ${recentReports.length} active reports (no writes):`);

  // ── Per-report simulation ──────────────────────────────────────────────────
  let grandTotal = 0;
  let grandMatched = 0;
  let grandRecipe = 0;
  let grandIgnored = 0;
  let grandUnknown = 0;

  // stockUnits by conversionSource from product matches
  const stockBySource = { servingMl: 0, conversionRatio: 0, each: 0, default: 0, unconvertible: 0 };
  // productId → { name, posUnits, stockUnits, convSource } for product matches
  const productMatchMap = new Map();
  // productId → { name, posUnits } for 'default' source product matches
  const defaultMatchMap = new Map();

  let totalRecipeDeductions = 0;
  let totalUnconvertible = 0;
  let totalRecipeMissing = 0;
  const recipeMissingNames = new Set();

  for (const r of recentReports) {
    const lines = r.rawLines ?? [];
    const result = classifySalesLines(
      lines, productIndex, confirmedMappings, fullMappings, recipesById, productById,
    );
    const c = result.counts;

    // Outcome in POS units — these four must sum to c.totalQtySold
    const matchedQtySold = result.matches.reduce((s, m) => s + (m.qtySold ?? 0), 0);
    const ignoredQtySold = result.ignored.reduce((s, i) => s + (i.qtySold ?? 0), 0);
    const unknownQtySold = result.unknowns.reduce((s, u) => s + (u.line?.qtySold ?? 0), 0);
    const recipeQtySold  = c.totalQtySold - matchedQtySold - ignoredQtySold - unknownQtySold;

    grandTotal   += c.totalQtySold;
    grandMatched += matchedQtySold;
    grandRecipe  += recipeQtySold;
    grandIgnored += ignoredQtySold;
    grandUnknown += unknownQtySold;

    console.log(
      `  ${r.id} (${r.startStr} → ${r.endStr}): ` +
      `${c.totalQtySold} POS units — ` +
      `matched=${matchedQtySold}, recipe=${recipeQtySold}, ` +
      `ignored=${ignoredQtySold}, unknown=${unknownQtySold}`,
    );

    // Stock units by conversion source
    for (const m of result.matches) {
      const src = m.conversionSource ?? 'default';
      if (src in stockBySource) stockBySource[src] += m.stockQty ?? 0;

      const pid = m.productId;
      if (!pid) continue;
      if (!productMatchMap.has(pid)) {
        productMatchMap.set(pid, { name: m.productName ?? pid, posUnits: 0, stockUnits: 0, convSource: src });
      }
      const e = productMatchMap.get(pid);
      e.posUnits  += m.qtySold ?? 0;
      e.stockUnits += m.stockQty ?? 0;
      if (e.convSource === 'default' && src !== 'default') e.convSource = src;

      if (src === 'default') {
        const dm = defaultMatchMap.get(pid) ?? { name: m.productName ?? pid, posUnits: 0 };
        dm.posUnits += m.qtySold ?? 0;
        defaultMatchMap.set(pid, dm);
      }
    }

    // Recipe deductions
    for (const rd of result.recipeDeductions) {
      totalRecipeDeductions++;
      if (rd.stockQty === null) totalUnconvertible++;
    }

    // Recipe missing
    totalRecipeMissing += c.recipeMissing;
    for (const u of result.unknowns) {
      if (u.reason === 'recipe_missing' && u.line?.name) {
        const mapping = fullMappings[(u.line.name ?? '').toLowerCase()];
        if (mapping?.recipeId) recipeMissingNames.add(mapping.recipeId);
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n── Units by outcome (last ${recentReports.length} reports) ──`);
  console.log(`  Total POS units:  ${grandTotal}`);
  console.log(`  Product matches:  ${grandMatched}  (${pct(grandMatched, grandTotal)}%)`);
  console.log(`  Recipe-mapped:    ${grandRecipe}   (${pct(grandRecipe,  grandTotal)}%)`);
  console.log(`  Ignored/skipped:  ${grandIgnored}  (${pct(grandIgnored, grandTotal)}%)`);
  console.log(`  Unknown:          ${grandUnknown}  (${pct(grandUnknown, grandTotal)}%)`);
  const checkSum = grandMatched + grandRecipe + grandIgnored + grandUnknown;
  if (checkSum !== grandTotal) {
    console.warn(`  ⚠ Sum check FAILED: ${checkSum} ≠ ${grandTotal}`);
  }

  console.log(`\n── Stock units from product matches by conversion source ──`);
  for (const [src, units] of Object.entries(stockBySource)) {
    console.log(`  ${src}: ${units.toFixed(3)}`);
  }

  console.log(`\n── Top 20 'default' product matches by POS units ──`);
  console.log(`  (auto-matched products with no serving/conversion info — stock = 1:1)`);
  const topDefault = [...defaultMatchMap.values()]
    .sort((a, b) => b.posUnits - a.posUnits)
    .slice(0, 20);
  if (topDefault.length === 0) {
    console.log('  (none)');
  } else {
    topDefault.forEach(e => console.log(`  ${e.name}: ${e.posUnits} POS units`));
  }

  console.log(`\n── Top 10 products by conversion change (|stock − POS|) ──`);
  const topChanged = [...productMatchMap.values()]
    .filter(e => Math.abs(e.stockUnits - e.posUnits) > 0.001)
    .sort((a, b) => Math.abs(b.stockUnits - b.posUnits) - Math.abs(a.stockUnits - a.posUnits))
    .slice(0, 10);
  if (topChanged.length === 0) {
    console.log('  (none)');
  } else {
    topChanged.forEach(e =>
      console.log(`  ${e.name}: POS=${e.posUnits.toFixed(2)}, stock=${e.stockUnits.toFixed(3)}, source=${e.convSource}`),
    );
  }

  console.log(`\n── Recipe deductions ──`);
  console.log(`  Ingredient deduction entries: ${totalRecipeDeductions}`);
  console.log(`  Unconvertible ingredients:    ${totalUnconvertible}`);
  console.log(`  Recipe missing (treated as unknown): ${totalRecipeMissing}`);
  if (recipeMissingNames.size > 0) {
    console.log(`  Missing recipe IDs: ${[...recipeMissingNames].join(', ')}`);
  }

  console.log('\n✓ Dry run complete — no writes performed.');
}

function pct(part, total) {
  if (!total) return '—';
  return ((part / total) * 100).toFixed(1);
}

main().catch(e => {
  console.error('Error:', e?.message ?? e);
  process.exit(1);
});
