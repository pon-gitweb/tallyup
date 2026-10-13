// Repair a department snapshot that was written with a missing or incorrect baseline.
//
// Loads the target snapshot and the most recent earlier snapshot, re-derives
// per-item openingCount / variance fields using snapshotWriter formulas, and
// recomputes all affected summary fields.
//
// Usage:
//   node scripts/admin/repair-snapshot-baseline.js --venue <venueId> --dept <deptId> --cycle <n>
//   node scripts/admin/repair-snapshot-baseline.js --venue <venueId> --dept <deptId> --cycle <n> --execute
//
// Dry run by default — prints before/after and writes a JSON backup to
// scripts/admin/output/. Pass --execute to actually write to Firestore.

const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');
const path = require('path');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}
const venueId  = getArg('--venue');
const deptId   = getArg('--dept');
const cycleArg = getArg('--cycle');
const execute  = args.includes('--execute');

if (!venueId || !deptId || !cycleArg) {
  console.error('Usage: node repair-snapshot-baseline.js --venue <id> --dept <id> --cycle <n> [--execute]');
  process.exit(1);
}
const cycleNumber = parseInt(cycleArg, 10);
if (isNaN(cycleNumber) || cycleNumber < 1) {
  console.error('--cycle must be a positive integer');
  process.exit(1);
}

// ── Firestore ───────────────────────────────────────────────────────────────
const db = new Firestore();

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtDollars(n) {
  if (n == null) return 'n/a';
  return `$${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}`;
}

// Re-derive all per-item fields that depend on openingCount, matching
// snapshotWriter.ts computeSnapshotItemFigures exactly.
function repairItems(targetItems, baselineItems, baseCycleNumber) {
  // Build name → actualClosing map from baseline snapshot
  const prevMap = new Map();
  for (const bi of baselineItems) {
    const key = (bi.name || '').toLowerCase().trim();
    if (key && typeof bi.actualClosing === 'number') {
      prevMap.set(key, bi.actualClosing);
    }
  }

  return targetItems.map(item => {
    const rawName = (item.name || '').toLowerCase().trim();
    const openingCount = prevMap.has(rawName) ? prevMap.get(rawName) : null;
    const actualClosing = typeof item.actualClosing === 'number' ? item.actualClosing : 0;
    const costPrice = typeof item.costPrice === 'number' ? item.costPrice : null;

    // Item 2: no-baseline items get 0 variance
    const totalVarianceQty     = openingCount != null ? actualClosing - openingCount : 0;
    const totalVarianceDollars = costPrice != null ? totalVarianceQty * costPrice : null;

    const isNewProduct = openingCount == null;
    const varianceConfidence = openingCount != null ? 'high' : 'low';
    const confidenceReason   = openingCount == null
      ? (cycleNumber === 1 ? 'First cycle for department' : 'New product — no prior cycle')
      : `Baseline from cycle ${baseCycleNumber}`;

    // expectedClosing, unexplainedVariance: only for baseline items
    let expectedClosing = item.expectedClosing;
    let unexplainedVarianceQty = totalVarianceQty;
    let unexplainedVarianceDollars = totalVarianceDollars;
    if (openingCount != null) {
      const receivedQty = typeof item.receivedQty === 'number' ? item.receivedQty : 0;
      const soldQty     = typeof item.soldQty === 'number' ? item.soldQty : null;
      expectedClosing       = openingCount + receivedQty - (soldQty ?? 0);
      unexplainedVarianceQty      = actualClosing - expectedClosing;
      unexplainedVarianceDollars  = costPrice != null ? unexplainedVarianceQty * costPrice : null;
    }

    // displayCostPrice tier carries over from original (invoice-verified etc.)
    const displayCostPrice = item.displayCostPrice ?? null;
    const displayTotalVarianceDollars      = displayCostPrice != null ? totalVarianceQty * displayCostPrice : null;
    const displayUnexplainedVarianceDollars = displayCostPrice != null ? unexplainedVarianceQty * displayCostPrice : null;

    return {
      ...item,
      openingCount,
      totalVarianceQty,
      totalVarianceDollars,
      unexplainedVarianceQty,
      unexplainedVarianceDollars,
      expectedClosing,
      isNewProduct,
      varianceConfidence,
      confidenceReason,
      displayTotalVarianceDollars,
      displayUnexplainedVarianceDollars,
    };
  });
}

function recomputeSummary(repairedItems, originalSummary) {
  const hasPrices = repairedItems.some(si => si.costPrice != null);
  const totalPricedItems = repairedItems.filter(si => si.costPrice != null).length;

  const totalVarianceQty = repairedItems.reduce((s, si) => s + si.totalVarianceQty, 0);
  const totalVarianceDollars = hasPrices
    ? repairedItems.reduce((s, si) => s + (si.totalVarianceDollars ?? 0), 0)
    : null;
  const unexplainedVarianceQty = repairedItems.reduce((s, si) => s + si.unexplainedVarianceQty, 0);
  const unexplainedVarianceDollars = hasPrices
    ? repairedItems.reduce((s, si) => s + (si.unexplainedVarianceDollars ?? 0), 0)
    : null;
  const totalStockValue = hasPrices
    ? repairedItems.filter(si => si.costPrice != null)
        .reduce((s, si) => s + si.actualClosing * si.costPrice, 0)
    : null;
  const hasDisplayPrices = repairedItems.some(si => si.displayCostPrice != null);
  const displayTotalStockValue = hasDisplayPrices
    ? repairedItems.reduce((s, si) => s + (si.displayCostPrice != null ? si.actualClosing * si.displayCostPrice : 0), 0)
    : null;
  const displayTotalVarianceDollars = hasDisplayPrices
    ? repairedItems.reduce((s, si) => s + (si.displayTotalVarianceDollars ?? 0), 0)
    : null;
  const displayUnexplainedVarianceDollars = hasDisplayPrices
    ? repairedItems.reduce((s, si) => s + (si.displayUnexplainedVarianceDollars ?? 0), 0)
    : null;
  const itemsWithBaseline     = repairedItems.filter(si => si.openingCount != null).length;
  const itemsWithoutBaseline  = repairedItems.filter(si => si.openingCount == null).length;

  return {
    ...originalSummary,
    totalVarianceQty,
    totalVarianceDollars,
    unexplainedVarianceQty,
    unexplainedVarianceDollars,
    totalStockValue,
    totalItemsCounted: repairedItems.length,
    totalItemsWithVariance: repairedItems.filter(si => si.totalVarianceQty !== 0).length,
    itemsWithBaseline,
    itemsWithoutBaseline,
    displayTotalStockValue,
    displayTotalVarianceDollars,
    displayUnexplainedVarianceDollars,
  };
}

function snapshotSummaryLine(summary) {
  return [
    `items=${summary.totalItemsCounted}`,
    `baseline=${summary.itemsWithBaseline ?? 'n/a'}`,
    `varianceQty=${summary.totalVarianceQty}`,
    `varianceDollars=${fmtDollars(summary.totalVarianceDollars)}`,
    `stockValue=${fmtDollars(summary.totalStockValue)}`,
  ].join('  ');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n── Snapshot repair ──────────────────────────────────────────────`);
  console.log(`venue=${venueId}  dept=${deptId}  cycle=${cycleNumber}  execute=${execute}`);

  // 1. Load target snapshot
  const targetRef = db.doc(
    `venues/${venueId}/departments/${deptId}/snapshots/cycle-${cycleNumber}`,
  );
  const targetDoc = await targetRef.get();
  if (!targetDoc.exists) {
    console.error(`\nTarget snapshot cycle-${cycleNumber} not found.`);
    process.exit(1);
  }
  const target = targetDoc.data();

  // 2. Find the most recent earlier snapshot
  const snapsRef = db.collection(`venues/${venueId}/departments/${deptId}/snapshots`);
  const earlierSnap = await snapsRef
    .where('cycleNumber', '<', cycleNumber)
    .orderBy('cycleNumber', 'desc')
    .limit(1)
    .get();

  if (earlierSnap.empty) {
    console.error(`\nNo earlier snapshot found for cycle < ${cycleNumber}. Cannot determine baseline.`);
    process.exit(1);
  }
  const baselineDoc = earlierSnap.docs[0];
  const baseline = baselineDoc.data();
  const baseCycleNumber = baseline.cycleNumber;

  console.log(`\nBaseline: cycle-${baseCycleNumber} (doc id: ${baselineDoc.id})`);
  console.log(`Target baseline was: ${target.baselineCycleNumber ?? 'not set (legacy)'}`);

  if (target.baselineCycleNumber === baseCycleNumber) {
    console.log('\n✓ Target already uses this baseline. No repair needed.');
    process.exit(0);
  }

  // 3. Re-derive items
  const originalItems = target.items || [];
  const baselineItems = baseline.items || [];

  console.log(`\nBaseline items: ${baselineItems.length}  Target items: ${originalItems.length}`);

  const repairedItems = repairItems(originalItems, baselineItems, baseCycleNumber);

  // 4. Recompute summary
  const repairedSummary = recomputeSummary(repairedItems, target.summary || {});

  // 5. Before/after summary
  console.log(`\n── BEFORE ───`);
  console.log(snapshotSummaryLine(target.summary || {}));
  console.log(`── AFTER ────`);
  console.log(snapshotSummaryLine(repairedSummary));

  // 6. Write JSON backup
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = path.join(
    outputDir,
    `repair-snapshot-${venueId.slice(0, 8)}-${deptId}-cycle${cycleNumber}-${Date.now()}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify({
    venueId, deptId, cycleNumber, baseCycleNumber,
    before: { summary: target.summary, baselineCycleNumber: target.baselineCycleNumber },
    after:  { summary: repairedSummary, baselineCycleNumber: baseCycleNumber },
  }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  if (!execute) {
    console.log('\nDry run complete. Pass --execute to write to Firestore.');
    return;
  }

  // 7. Write corrected snapshot
  const repairedSnapshot = {
    ...target,
    items: repairedItems,
    summary: repairedSummary,
    baselineCycleNumber: baseCycleNumber,
    baselineGapNote: target.baselineGapNote ?? null,
    repairedAt: new Date().toISOString(),
    repairedFrom: `cycle-${baseCycleNumber}`,
    repairNote: `Baseline corrected from ${target.baselineCycleNumber ?? 'none'} to cycle-${baseCycleNumber} by repair script`,
  };

  await targetRef.set(repairedSnapshot);
  console.log(`\n✓ Snapshot cycle-${cycleNumber} written to Firestore with baseline from cycle-${baseCycleNumber}.`);
}

main().catch(err => {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
});
