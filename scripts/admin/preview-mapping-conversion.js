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
 * Exits non-zero on any write attempt (write APIs are not imported).
 */

'use strict';

// ── Guard: ensure no write APIs are ever imported ────────────────────────────
const BANNED_WRITE_APIS = ['setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction', 'set', 'update', 'delete', 'add'];

const originalRequire = Module.prototype.require;
const Module = require('module');
Module.prototype.require = function (id) {
  // Allow firebase-admin — but we'll never call write methods on purpose.
  return originalRequire.apply(this, arguments);
};

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const venueIdx = args.indexOf('--venue');
const venueId = venueIdx >= 0 ? args[venueIdx + 1] : null;

if (!venueId) {
  console.error('Usage: node scripts/admin/preview-mapping-conversion.js --venue <venueId>');
  process.exit(1);
}

// ── Load firebase-admin and compiled modules ─────────────────────────────────
const path = require('path');
const admin = require(path.join(__dirname, '../../functions/node_modules/firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Load compiled pure functions
const functionsLib = path.join(__dirname, '../../functions/lib');
const { parseProductSize } = require(path.join(functionsLib, 'productSize'));
const { stockUnitsPerSale, ingredientStockQty } = require(path.join(functionsLib, 'mappingConversion'));
const { matchDocToMatchData, partitionReports } = require(path.join(functionsLib, 'weeklyLedger'));

// ── Helpers ──────────────────────────────────────────────────────────────────
function normName(s) {
  return (s ?? '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function parseRawDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000);
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== preview-mapping-conversion: venue ${venueId} ===\n`);

  // ── Load products ──────────────────────────────────────────────────────────
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const productById = {};
  productsSnap.forEach(d => { productById[d.id] = { id: d.id, ...d.data() }; });
  const allProducts = Object.values(productById);
  console.log(`Products: ${allProducts.length}`);

  // ── Product size parse stats ───────────────────────────────────────────────
  const parseStats = { ml: 0, g: 0, each: 0, unparsed: 0 };
  const unparsedNames = [];
  for (const p of allProducts) {
    const parsed = parseProductSize(p.size ?? null, p.unit ?? null);
    if (!parsed) {
      parseStats.unparsed++;
      unparsedNames.push(`  ${p.name ?? '?'}: size=${JSON.stringify(p.size)}, unit=${JSON.stringify(p.unit)}`);
    } else {
      parseStats[parsed.base]++;
    }
  }
  console.log(`\nProduct size parse stats:`);
  console.log(`  ml:      ${parseStats.ml}`);
  console.log(`  g:       ${parseStats.g}`);
  console.log(`  each:    ${parseStats.each}`);
  console.log(`  unparsed: ${parseStats.unparsed}`);
  if (unparsedNames.length > 0) {
    console.log(`\nFirst ${Math.min(30, unparsedNames.length)} unparsed products:`);
    unparsedNames.slice(0, 30).forEach(s => console.log(s));
  }

  // ── Load mappings ──────────────────────────────────────────────────────────
  const mappingsSnap = await db.collection(`venues/${venueId}/posProductMappings`).get();
  const fullMappings = {};
  mappingsSnap.forEach(d => {
    const data = d.data();
    const key = (data.posItemName ?? '').toLowerCase();
    if (key) fullMappings[key] = { id: d.id, ...data };
  });

  const mappingsByType = {};
  const mappingsBySource = { servingMl: 0, conversionRatio: 0, each: 0, default: 0, unconvertible: 0 };
  for (const m of Object.values(fullMappings)) {
    const t = m.mappingType ?? 'unknown';
    mappingsByType[t] = (mappingsByType[t] ?? 0) + 1;
    if (m.mappingType !== 'skipped' && !m.recipeId) {
      const product = m.productId ? productById[m.productId] ?? null : null;
      const conv = stockUnitsPerSale(m, product);
      mappingsBySource[conv.source]++;
    }
  }
  console.log(`\nMappings by mappingType:`);
  Object.entries(mappingsByType).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
  console.log(`\nProduct mappings by conversion source:`);
  Object.entries(mappingsBySource).forEach(([s, n]) => console.log(`  ${s}: ${n}`));

  // ── Load recipes ───────────────────────────────────────────────────────────
  const recipesSnap = await db.collection(`venues/${venueId}/recipes`).get();
  const recipeById = {};
  recipesSnap.forEach(d => { recipeById[d.id] = { id: d.id, ...d.data() }; });

  // ── Load active sales reports (last 4 complete weeks) ──────────────────────
  const reportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
  const { reports: activeReports } = partitionReports(reportsSnap.docs);

  // Find last 4 complete weeks boundary
  const now = new Date();
  const todayNZ = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const currentMonMs = new Date(todayNZ.slice(0, 7) + '-01T00:00:00Z').getTime(); // approx

  // Take up to 4 most recent reports (by startMs)
  const recentReports = activeReports
    .filter(r => r.startStr)
    .sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
    .slice(0, 4);

  console.log(`\nSimulating re-match of last ${recentReports.length} active reports (no writes):`);

  let totalPOSUnits = 0;
  let totalStockUnits = 0;
  const productChanges = new Map(); // productId → { name, posUnits, stockUnits, source }

  let totalRecipeDeductions = 0;
  let totalUnconvertibleIngredients = 0;
  let totalIgnored = 0;
  let totalRecipeMissing = 0;
  const recipeMissingNames = new Set();
  // productId → { name, posUnits, source } for default-source product matches
  const defaultMatches = new Map();

  for (const r of recentReports) {
    const linesSnap = r.rawLines ?? [];
    let repPOSUnits = 0, repStockUnits = 0;

    for (const ln of linesSnap) {
      if (!ln.name) continue;
      const qty = ln.qtySold ?? 0;
      repPOSUnits += qty;
      const lineKey = ln.name.toLowerCase();
      const mapping = fullMappings[lineKey];

      if (mapping?.mappingType === 'skipped') {
        totalIgnored += qty;
        repStockUnits += qty;
        continue;
      }

      if (mapping?.recipeId) {
        const recipe = recipeById[mapping.recipeId];
        if (!recipe) {
          totalRecipeMissing++;
          recipeMissingNames.add(mapping.recipeId);
          continue;
        }
        const items = Array.isArray(recipe.items) ? recipe.items : [];
        for (const item of items) {
          if (!item.productId) continue;
          const ingProd = productById[item.productId] ?? null;
          const { stockQty } = ingredientStockQty(qty, item.qty, item.unit ?? 'each', recipe.yield ?? null, ingProd);
          totalRecipeDeductions++;
          if (stockQty === null) {
            totalUnconvertibleIngredients++;
          } else {
            const pid = item.productId;
            const name = item.productName ?? ingProd?.name ?? pid;
            if (!productChanges.has(pid)) productChanges.set(pid, { name, posUnits: 0, stockUnits: 0, source: 'recipe' });
            productChanges.get(pid).stockUnits += stockQty;
            repStockUnits += stockQty;
          }
        }
        continue;
      }

      if (mapping?.productId) {
        const product = productById[mapping.productId] ?? null;
        const conv = stockUnitsPerSale(mapping, product);
        const stockQty = qty * conv.qty;
        const pid = mapping.productId;
        const name = product?.name ?? pid;
        if (!productChanges.has(pid)) productChanges.set(pid, { name, posUnits: 0, stockUnits: 0, source: conv.source });
        const e = productChanges.get(pid);
        e.posUnits   += qty;
        e.stockUnits += stockQty;
        if (e.source === 'default' && conv.source !== 'default') e.source = conv.source;
        repStockUnits += stockQty;
        // Track default-source matches separately
        if (conv.source === 'default') {
          const dm = defaultMatches.get(pid) ?? { name, posUnits: 0 };
          dm.posUnits += qty;
          defaultMatches.set(pid, dm);
        }
      }
    }

    totalPOSUnits   += repPOSUnits;
    totalStockUnits += repStockUnits;
    console.log(`  ${r.id} (${r.startStr} → ${r.endStr}): ${repPOSUnits} POS units → ${repStockUnits.toFixed(2)} stock units`);
  }

  console.log(`\nTotals across ${recentReports.length} reports:`);
  console.log(`  Total POS units:   ${totalPOSUnits}`);
  console.log(`  Total stock units: ${totalStockUnits.toFixed(2)}`);

  // Top 20 products by absolute change (|stockUnits - posUnits|)
  const changed = [...productChanges.values()]
    .filter(e => Math.abs(e.stockUnits - e.posUnits) > 0.001)
    .sort((a, b) => Math.abs(b.stockUnits - b.posUnits) - Math.abs(a.stockUnits - a.posUnits))
    .slice(0, 20);

  if (changed.length > 0) {
    console.log(`\nTop ${changed.length} products by conversion change (POS units → stock units):`);
    for (const e of changed) {
      console.log(`  ${e.name}: POS=${e.posUnits.toFixed(2)}, stock=${e.stockUnits.toFixed(2)}, source=${e.source}`);
    }
  }

  // Default-source product matches (no conversion info — still recorded as 1:1)
  const topDefault = [...defaultMatches.values()]
    .sort((a, b) => b.posUnits - a.posUnits)
    .slice(0, 20);
  console.log(`\nProduct matches with conversionSource 'default' (no conversion info, 1:1): ${defaultMatches.size} products`);
  if (topDefault.length > 0) {
    console.log(`Top ${topDefault.length} by POS units:`);
    topDefault.forEach(e => console.log(`  ${e.name}: ${e.posUnits} POS units`));
  }

  console.log(`\nRecipe deductions: ${totalRecipeDeductions} ingredient entries`);
  console.log(`Unconvertible ingredients: ${totalUnconvertibleIngredients}`);
  console.log(`Ignored (skipped) POS units: ${totalIgnored}`);
  console.log(`Recipe missing (recipe doc absent — treated as unknown): ${totalRecipeMissing}`);
  if (recipeMissingNames.size > 0) {
    console.log(`Missing recipe IDs: ${[...recipeMissingNames].join(', ')}`);
  }

  console.log('\n✓ Dry run complete — no writes performed.');
}

main().catch(e => {
  console.error('Error:', e?.message ?? e);
  process.exit(1);
});
