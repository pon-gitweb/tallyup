// Dry-run reconcile engine for a single stocktake cycle.
//
// Reads Firestore data (read-only), runs the pure reconcile engine, and
// prints a summary to stdout. No data is written.
//
// Usage:
//   node scripts/admin/reconcile-dry-run.js \
//     --venue <venueId> --dept <deptName> --cycle <n> \
//     [--tz Pacific/Auckland] [--closed 1] [--timing pre_service]
//
// --closed: comma-separated weekday numbers (0=Sun, 1=Mon, … 6=Sat).
//           Default: none (all days open).
// --timing: pre_service or post_service. Default: pre_service.

'use strict';

const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');
const path = require('path');

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const venueId  = getArg('--venue');
const deptArg  = getArg('--dept');
const cycleArg = getArg('--cycle');
const tzArg    = getArg('--tz') || 'Pacific/Auckland';
const closedArg = getArg('--closed') || '';
const timingArg = getArg('--timing') || 'pre_service';

if (!venueId || !deptArg || !cycleArg) {
  console.error('Usage: node reconcile-dry-run.js --venue <id> --dept <name> --cycle <n>');
  process.exit(1);
}

const cycleNumber = parseInt(cycleArg, 10);
if (isNaN(cycleNumber) || cycleNumber < 1) {
  console.error('--cycle must be a positive integer');
  process.exit(1);
}

const closedWeekdays = closedArg
  ? closedArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  : [];

if (timingArg !== 'pre_service' && timingArg !== 'post_service') {
  console.error('--timing must be pre_service or post_service');
  process.exit(1);
}

// ── Firestore (read-only, ambient credentials) ───────────────────────────────

const db = new Firestore();

// ── Load compiled engine ──────────────────────────────────────────────────────

const enginePath = path.join(__dirname, '../../functions/lib/reconcile/engine.js');
if (!fs.existsSync(enginePath)) {
  console.error(`Engine not found at ${enginePath}. Run: npm --prefix functions run build`);
  process.exit(1);
}
const { reconcileSnapshot } = require(enginePath);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDollars(n) {
  if (n == null) return 'n/a';
  return `$${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}`;
}

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

// Load snapshot items from inline array or itemChunks subcollection.
async function loadItems(docRef, data) {
  if ((data.itemChunkCount || 0) > 0) {
    const chunksSnap = await docRef.collection('itemChunks').get();
    return chunksSnap.docs
      .sort((a, b) => a.data().index - b.data().index)
      .flatMap(c => c.data().items || []);
  }
  return data.items || [];
}

// Build mergedInto map: productId → survivorId (one hop only; engine walks chains).
function buildMergedIntoMap(productsSnap) {
  const map = {};
  productsSnap.forEach(d => {
    const mi = d.data().mergedInto;
    if (mi && typeof mi === 'string') map[d.id] = mi;
  });
  return map;
}

// Compute totalRevenue from a salesReport doc's rawLines.
function reportTotalRevenue(data) {
  const rawLines = data.rawLines || data.report?.lines || [];
  return rawLines.reduce((s, l) => s + (l.grossIncl || l.gross || 0), 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n── Reconcile dry-run ────────────────────────────────────────────`);
  console.log(`venue=${venueId}  dept=${deptArg}  cycle=${cycleNumber}  tz=${tzArg}  closed=[${closedWeekdays}]  timing=${timingArg}`);

  // 1. Find department by name
  const deptsSnap = await db.collection(`venues/${venueId}/departments`).get();
  const deptDoc = deptsSnap.docs.find(d => {
    const name = (d.data().name || '').toLowerCase().trim();
    return name === deptArg.toLowerCase().trim();
  });
  if (!deptDoc) {
    console.error(`Department "${deptArg}" not found in venue ${venueId}`);
    process.exit(1);
  }
  const deptId = deptDoc.id;
  console.log(`Department: ${deptDoc.data().name} (${deptId})`);

  // 2. Load target snapshot
  const snapsRef  = db.collection(`venues/${venueId}/departments/${deptId}/snapshots`);
  const targetRef = snapsRef.doc(`cycle-${cycleNumber}`);
  const targetDoc = await targetRef.get();
  if (!targetDoc.exists) {
    console.error(`Snapshot cycle-${cycleNumber} not found`);
    process.exit(1);
  }
  const targetData = targetDoc.data();
  const rawItems = await loadItems(targetRef, targetData);
  console.log(`Snapshot cycle-${cycleNumber}: ${rawItems.length} items`);

  // countStart from snapshot (Timestamp or Date)
  const thisCountStart = tsToDate(
    targetData.countStart || targetData.cycleStart || targetData.completedAt || targetData.createdAt,
  );
  if (!thisCountStart) {
    console.error('Cannot determine countStart from snapshot. Expected cycleStart, countStart, completedAt or createdAt.');
    process.exit(1);
  }

  // 3. Load baseline (previous cycle) snapshot for openingCountStart
  const earlierSnap = await snapsRef
    .where('cycleNumber', '<', cycleNumber)
    .orderBy('cycleNumber', 'desc')
    .limit(1)
    .get();

  if (earlierSnap.empty) {
    console.error(`No earlier snapshot found for cycle < ${cycleNumber}. Cannot determine opening window.`);
    process.exit(1);
  }
  const baselineDoc = earlierSnap.docs[0];
  const baselineData = baselineDoc.data();
  const openingCountStart = tsToDate(
    baselineData.countStart || baselineData.cycleStart || baselineData.completedAt || baselineData.createdAt,
  );
  if (!openingCountStart) {
    console.error('Cannot determine countStart from baseline snapshot.');
    process.exit(1);
  }
  const toNZ = d => d.toLocaleDateString('en-CA', { timeZone: tzArg });
  console.log(`Baseline: cycle-${baselineData.cycleNumber} (countStart NZ: ${toNZ(openingCountStart)})`);
  console.log(`Target countStart NZ: ${toNZ(thisCountStart)}`);

  // 4. Build snapshot items (product-level, with openingCount from stored field)
  const snapshotItems = rawItems.map(item => ({
    productId: item.productId || null,
    name: item.name || null,
    openingCount: typeof item.openingCount === 'number' ? item.openingCount : null,
    actualClosing: typeof item.actualClosing === 'number' ? item.actualClosing : 0,
    costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
  }));

  // 5. Load active salesReports
  const salesReportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
  const activeSalesReports = [];
  salesReportsSnap.forEach(d => {
    const data = d.data();
    // isReportActive: active when status is null/undefined/'active'
    const s = data.status;
    if (s !== undefined && s !== null && s !== 'active') return;
    const ps = tsToDate(data.periodStart);
    const pe = tsToDate(data.periodEnd);
    if (!ps || !pe) return;
    activeSalesReports.push({
      id: d.id,
      periodStart: ps,
      periodEnd: pe,
      totalRevenue: reportTotalRevenue(data),
    });
  });
  console.log(`Active sales reports: ${activeSalesReports.length}`);

  // 6. Load salesReportMatches
  const matchesSnap = await db.collection(`venues/${venueId}/salesReportMatches`).get();
  const matchDocsByReportId = {};
  matchesSnap.forEach(d => {
    const data = d.data();
    matchDocsByReportId[d.id] = {
      matches: data.matches || [],
      recipeDeductions: data.recipeDeductions || [],
    };
  });
  console.log(`Sales report match docs: ${matchesSnap.size}`);

  // 7. Load invoices
  const invoicesSnap = await db.collection(`venues/${venueId}/invoices`).get();
  const invoices = invoicesSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      invoiceDateTimestamp: data.invoiceDateTimestamp || data.date || null,
      type: data.type || null,
      lines: data.lines || [],
    };
  });
  console.log(`Invoices: ${invoices.length}`);

  // 8. Load posProductMappings
  const mappingsSnap = await db.collection(`venues/${venueId}/posProductMappings`).get();
  const posProductMappings = mappingsSnap.docs.map(d => {
    const data = d.data();
    return { id: d.id, productId: data.productId || null, mappingType: data.mappingType || null };
  });
  console.log(`POS product mappings: ${posProductMappings.length}`);

  // 9. Load products for mergedInto chain
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const mergedInto = buildMergedIntoMap(productsSnap);
  console.log(`Products: ${productsSnap.size}  Merged: ${Object.keys(mergedInto).length}`);

  // 10. Run reconcile engine
  const result = reconcileSnapshot({
    tz: tzArg,
    closedWeekdays,
    countTiming: timingArg,
    openingCountStart,
    thisCountStart,
    snapshotItems,
    salesReports: activeSalesReports,
    matchDocsByReportId,
    invoices,
    posProductMappings,
    mergedInto,
  });

  // 11. Print summary
  const { window, reports, sales, deliveries, items, summary } = result;

  console.log(`\n── Window ───────────────────────────────────────────────────────`);
  console.log(`Trading dates (${window.length}): ${window.join(', ')}`);

  console.log(`\n── Reports ──────────────────────────────────────────────────────`);
  console.log(`Attached (${reports.attached.length}): ${reports.attached.map(r => r.id).join(', ') || 'none'}`);
  console.log(`Partial  (${reports.partial.length}): ${reports.partial.map(r => r.id).join(', ') || 'none'}`);
  console.log(`Conflicts(${reports.conflicts.length}): ${reports.conflicts.map(r => r.id).join(', ') || 'none'}`);
  console.log(`Uncovered dates (${reports.uncoveredDates.length}): ${reports.uncoveredDates.join(', ') || 'none'}`);
  console.log(`Coverage complete: ${reports.coverageComplete}`);

  console.log(`\n── Sales ────────────────────────────────────────────────────────`);
  console.log(`Excluded lines: ${sales.excludedLines}  Excluded revenue: ${fmtDollars(sales.excludedRevenue)}`);
  const flagCounts = {};
  for (const flags of Object.values(sales.flagsByProductId)) {
    for (const f of flags) flagCounts[f] = (flagCounts[f] || 0) + 1;
  }
  for (const [flag, count] of Object.entries(flagCounts)) {
    console.log(`  flag[${flag}]: ${count} products`);
  }

  console.log(`\n── Deliveries ───────────────────────────────────────────────────`);
  console.log(`Unlinked lines: ${deliveries.unlinkedLines}  Ambiguous lines: ${deliveries.ambiguousLines}`);

  console.log(`\n── Item summary ─────────────────────────────────────────────────`);
  console.log(`Total items: ${summary.totalItems}`);
  for (const [status, count] of Object.entries(summary.byStatus).sort()) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`Total shortfall: ${fmtDollars(summary.totalShortfallDollars)} (${summary.totalShortfall.toFixed(2)} units)`);
  console.log(`Implied deliveries: ${summary.impliedDeliveryCount}`);
  console.log(`Linked sales %: ${summary.linkedSalesPct != null ? summary.linkedSalesPct.toFixed(1) + '%' : 'n/a'}`);

  // Top 10 shortfalls
  const shortfallItems = items
    .filter(i => i.shortfall != null && i.shortfall > 0)
    .sort((a, b) => (b.shortfallDollars || b.shortfall || 0) - (a.shortfallDollars || a.shortfall || 0))
    .slice(0, 10);
  if (shortfallItems.length > 0) {
    console.log(`\nTop ${shortfallItems.length} shortfalls:`);
    shortfallItems.forEach(i => {
      console.log(`  ${i.name || i.productId}: qty ${i.shortfall?.toFixed(2)} ${fmtDollars(i.shortfallDollars)}`);
    });
  }

  // Top 10 implied deliveries
  const impliedItems = items
    .filter(i => i.impliedDelivery != null && i.impliedDelivery > 0)
    .sort((a, b) => (b.impliedDeliveryDollars || b.impliedDelivery || 0) - (a.impliedDeliveryDollars || a.impliedDelivery || 0))
    .slice(0, 10);
  if (impliedItems.length > 0) {
    console.log(`\nTop ${impliedItems.length} implied deliveries:`);
    impliedItems.forEach(i => {
      console.log(`  ${i.name || i.productId}: qty ${i.impliedDelivery?.toFixed(2)} ${fmtDollars(i.impliedDeliveryDollars)}`);
    });
  }

  // Alarms
  const alarms = items.filter(i => i.status === 'alarm_sold_not_counted');
  if (alarms.length > 0) {
    console.log(`\nAlarms — sold but not counted (${alarms.length}):`);
    alarms.forEach(i => {
      console.log(`  ${i.name || i.productId}: sold ${i.sold}`);
    });
  }

  console.log(`\nFingerprint: ${result.inputsFingerprint}`);

  // 12. Write full JSON to output/
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(outputDir, `reconcile-${venueId.slice(0, 8)}-${deptArg}-cycle${cycleNumber}-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, jsonReplacer, 2));
  console.log(`\nFull result written to: ${outputPath}`);
}

function jsonReplacer(_key, value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

main().catch(err => {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
});
