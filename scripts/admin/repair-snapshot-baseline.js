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

// ── CLI args (only parsed when run directly) ─────────────────────────────────
let venueId, deptId, cycleNumber, execute, fromStored;

if (require.main === module) {
  const args = process.argv.slice(2);
  function getArg(flag) {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  }
  venueId    = getArg('--venue');
  deptId     = getArg('--dept');
  const cycleArg = getArg('--cycle');
  execute    = args.includes('--execute');
  fromStored = args.includes('--from-stored');

  if (!venueId || !deptId || !cycleArg) {
    console.error(
      'Usage: node repair-snapshot-baseline.js --venue <id> --dept <id> --cycle <n> [--execute] [--from-stored]'
    );
    process.exit(1);
  }
  cycleNumber = parseInt(cycleArg, 10);
  if (isNaN(cycleNumber) || cycleNumber < 1) {
    console.error('--cycle must be a positive integer');
    process.exit(1);
  }
}

// ── Firestore ───────────────────────────────────────────────────────────────
const db = require.main === module ? new Firestore() : null;

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
    const key = normaliseName(bi.name);
    if (key && typeof bi.actualClosing === 'number') {
      prevMap.set(key, bi.actualClosing);
    }
  }

  return targetItems.map(item => {
    const rawName = normaliseName(item.name);
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

// ── productKey: mirrors src/utils/productSnapshotItems.ts ────────────────────
function normaliseName(name) {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Walk mergedInto chain to the final survivor (doc with no mergedInto).
// Cycle-safe (visited Set), capped at 10 hops. Returns survivor id or null.
function resolveProductChainJs(startId, prodById) {
  let id = startId;
  const visited = new Set();
  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(id)) return null; // cycle detected
    visited.add(id);
    const entry = prodById[id];
    if (!entry) return null;          // doc missing in chain
    if (!entry.mergedInto) return id; // no further pointer — this is the survivor
    id = entry.mergedInto;
  }
  return null; // depth cap reached
}

function productKey(item, liveProductIds) {
  const pid = typeof item.productId === 'string' && item.productId ? item.productId : null;
  if (pid != null && liveProductIds != null && liveProductIds.has(pid)) return pid;
  return normaliseName(item.name);
}

// ── toProductItems: aggregate legacy per-area rows to product-level ───────────
// Mirrors toProductItems() from productSnapshotItems.ts for use in repair.
function toProductItemsForRepair(items, granularity) {
  if (granularity === 'product') return items;
  const grouped = new Map();
  for (const item of items) {
    const key = productKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const result = [];
  for (const [, rows] of grouped) {
    const base = rows[0];
    const areas = rows.map(r => ({
      areaId: r.areaId ?? null,
      areaName: r.areaName ?? null,
      actualClosing: typeof r.actualClosing === 'number' ? r.actualClosing : 0,
    }));
    const actualClosing = areas.reduce((s, a) => s + a.actualClosing, 0);
    if (rows.length === 1) {
      result.push({ ...base, areas, varianceReliable: true });
    } else {
      result.push({
        ...base, actualClosing, areas,
        openingCount: null, expectedClosing: null,
        totalVarianceQty: null, totalVarianceDollars: null,
        unexplainedVarianceQty: null, unexplainedVarianceDollars: null,
        varianceReliable: false,
      });
    }
  }
  return result;
}

// ── Load raw area items from the live areas subcollection ─────────────────────
async function loadAreaItems(dbInst, venueId, deptId) {
  const areasRef = dbInst.collection(`venues/${venueId}/departments/${deptId}/areas`);
  const areasSnap = await areasRef.get();
  const rawItems = [];
  for (const areaDoc of areasSnap.docs) {
    const areaName = areaDoc.data().name || areaDoc.id;
    const itemsSnap = await areaDoc.ref.collection('items').get();
    for (const itemDoc of itemsSnap.docs) {
      rawItems.push({ _id: itemDoc.id, _areaId: areaDoc.id, _areaName: areaName, ...itemDoc.data() });
    }
  }
  return rawItems;
}

// ── Build raw items from stored snapshot (for --from-stored) ─────────────────
// Pure helper: counts come from stored snapshot rows, productId from liveItemsById.
// itemsGranularity: exactly 'product' → iterate item.areas[];
//                   anything else (incl. undefined/null) → legacy: each stored
//                   item IS one area row; item.productId holds the area row doc id.
// Mirrors toProductItems in productSnapshotItems.ts: only === 'product' is product.
// liveItemsById: Map<areaItemId, productId | null>
function buildRawItemsFromStoredSync(storedProductItems, liveItemsById, itemsGranularity) {
  let noLiveItemCount = 0;
  const rawItems = [];
  const isLegacy = itemsGranularity !== 'product';
  for (const item of storedProductItems) {
    if (isLegacy) {
      // Legacy granularity: each stored item IS one area row.
      // item.productId holds the area row doc id (areaItemId), not a catalog product id.
      const areaItemId = item.productId ?? null;
      let liveProductId = null;
      if (areaItemId != null) {
        if (liveItemsById.has(areaItemId)) {
          liveProductId = liveItemsById.get(areaItemId) ?? null;
        } else {
          noLiveItemCount++;
        }
      } else {
        noLiveItemCount++;
      }
      rawItems.push({
        _id: areaItemId,
        _areaId: item.areaId ?? null,
        _areaName: item.areaName ?? null,
        name: item.name,
        productId: liveProductId,
        lastCount: typeof item.actualClosing === 'number' ? item.actualClosing : 0,
        costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
        displayCostPrice: typeof item.displayCostPrice === 'number' ? item.displayCostPrice : null,
      });
    } else {
      // Product granularity: iterate areas[].
      const areas = item.areas || [];
      if (areas.length === 0) {
        noLiveItemCount++;
        rawItems.push({
          _id: null,
          _areaId: null,
          _areaName: null,
          name: item.name,
          productId: null,
          lastCount: typeof item.actualClosing === 'number' ? item.actualClosing : 0,
          costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
          displayCostPrice: typeof item.displayCostPrice === 'number' ? item.displayCostPrice : null,
        });
        continue;
      }
      for (const areaEntry of areas) {
        const areaItemId = areaEntry.areaItemId ?? null;
        let liveProductId = null;
        if (areaItemId != null) {
          if (liveItemsById.has(areaItemId)) {
            liveProductId = liveItemsById.get(areaItemId) ?? null;
          } else {
            noLiveItemCount++;
          }
        } else {
          noLiveItemCount++;
        }
        rawItems.push({
          _id: areaItemId,
          _areaId: areaEntry.areaId ?? null,
          _areaName: areaEntry.areaName ?? null,
          name: item.name,
          productId: liveProductId,
          lastCount: typeof areaEntry.actualClosing === 'number' ? areaEntry.actualClosing : 0,
          costPrice: typeof item.costPrice === 'number' ? item.costPrice : null,
          displayCostPrice: typeof item.displayCostPrice === 'number' ? item.displayCostPrice : null,
        });
      }
    }
  }
  return { rawItems, noLiveItemCount };
}

// ── Aggregate raw area items to product-level (mirrors snapshotWriter) ────────
// Two-pass aggregation matching the writer's logic:
//   Pass 1 — for every row whose resolved id is a live survivor, record
//            normalisedName → Set<survivorId>. Names with exactly one survivor
//            go into nameToProductId (unambiguous).
//   Pass 2 — key = live resolved productId if present; else
//            nameToProductId[name] if present; else 'name:'+name.
//            Names with >1 distinct survivors are ambiguous: those rows get
//            varianceReliable: false and ambiguousName: true.
// Optional resolvedIdById maps stale/merged product ids to their survivor.
function aggregateAreaItemsToProducts(rawItems, liveProductIds, resolvedIdById) {
  liveProductIds = liveProductIds ?? new Set();
  resolvedIdById = resolvedIdById ?? {};

  // Pass 1: build name → Set<survivorId>
  const nameToSurvivorIds = new Map();
  for (const item of rawItems) {
    if (!item.productId) continue;
    const rPid = resolvedIdById[item.productId] ?? item.productId;
    if (liveProductIds.has(rPid)) {
      const n = normaliseName(item.name);
      if (n) {
        if (!nameToSurvivorIds.has(n)) nameToSurvivorIds.set(n, new Set());
        nameToSurvivorIds.get(n).add(rPid);
      }
    }
  }
  const nameToProductId = new Map();
  for (const [n, pids] of nameToSurvivorIds) {
    if (pids.size === 1) nameToProductId.set(n, [...pids][0]);
  }

  // Pass 2: aggregate
  const aggMap = new Map();
  for (const item of rawItems) {
    const n = normaliseName(item.name);
    let groupPid = null;
    let key;
    let isAmbiguous = false;
    if (item.productId) {
      const rPid = resolvedIdById[item.productId] ?? item.productId;
      if (liveProductIds.has(rPid)) {
        groupPid = rPid;
        key = rPid;
      } else {
        isAmbiguous = (nameToSurvivorIds.get(n)?.size ?? 0) > 1;
        groupPid = nameToProductId.get(n) ?? null;
        key = groupPid ?? ('name:' + n);
      }
    } else {
      isAmbiguous = (nameToSurvivorIds.get(n)?.size ?? 0) > 1;
      groupPid = nameToProductId.get(n) ?? null;
      key = groupPid ?? ('name:' + n);
    }
    const lastCnt = typeof item.lastCount === 'number' ? item.lastCount : 0;
    const areaEntry = {
      areaId: item._areaId ?? null,
      areaName: item._areaName ?? null,
      areaItemId: item._id ?? null,
      actualClosing: lastCnt,
      lastCountAt: item.lastCountAt ?? null,
      lastCountBy: item.lastCountBy ?? null,
    };
    if (!aggMap.has(key)) {
      aggMap.set(key, { base: item, areas: [areaEntry], sum: lastCnt, groupPid, ambiguous: isAmbiguous });
    } else {
      const e = aggMap.get(key);
      e.areas.push(areaEntry);
      e.sum += lastCnt;
      if (!e.groupPid && groupPid) e.groupPid = groupPid;
      if (isAmbiguous) e.ambiguous = true;
    }
  }

  const products = [];
  for (const [, { base, areas, sum, groupPid, ambiguous }] of aggMap) {
    const costPrice = typeof base.costPrice === 'number' ? base.costPrice : null;
    products.push({
      productId: groupPid ?? null,
      name: base.name,
      actualClosing: sum,
      costPrice,
      parLevel: typeof base.parLevel === 'number' ? base.parLevel : null,
      areas,
      varianceReliable: ambiguous ? false : true,
      ambiguousName: ambiguous || undefined,
    });
  }

  // Count output items sharing a normalised name (same-name distinct survivors is allowed;
  // this count is informational — mainFromStored prints them but does not abort)
  const nameCount = new Map();
  for (const p of products) {
    const n = normaliseName(p.name);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const nameDuplicates = [...nameCount.entries()]
    .filter(([, v]) => v > 1)
    .reduce((s, [, v]) => s + (v - 1), 0);

  return { products, areaRowCount: rawItems.length, nameDuplicates, nameToProductId };
}

// ── Chunk loader (admin SDK) ──────────────────────────────────────────────────
async function loadItems(docRef, data) {
  if ((data.itemChunkCount ?? 0) > 0) {
    const chunksSnap = await docRef.collection('itemChunks').get();
    return chunksSnap.docs
      .map(d => d.data())
      .sort((a, b) => a.index - b.index)
      .flatMap(c => c.items);
  }
  return data.items ?? [];
}

// ── --from-stored: rebuild product items from stored snapshot counts ──────────
async function mainFromStored() {
  // 1. Load target snapshot (for metadata + previous cycle reference)
  const targetRef = db.doc(`venues/${venueId}/departments/${deptId}/snapshots/cycle-${cycleNumber}`);
  const targetDoc = await targetRef.get();
  if (!targetDoc.exists) {
    console.error(`\nTarget snapshot cycle-${cycleNumber} not found.`);
    process.exit(1);
  }
  const target = targetDoc.data();

  // 2. Load product catalogue and build full chain resolution
  console.log('\nLoading product catalogue...');
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const prodById = {};
  for (const d of productsSnap.docs) {
    const p = d.data();
    prodById[d.id] = {
      name: normaliseName(p.name || ''),
      mergedInto: p.mergedInto ?? null,
      costPrice: typeof p.costPrice === 'number' ? p.costPrice : null,
    };
  }
  const resolvedIdById = {};
  for (const d of productsSnap.docs) {
    const survivorId = resolveProductChainJs(d.id, prodById);
    if (survivorId != null) resolvedIdById[d.id] = survivorId;
  }
  const liveProductIds = new Set(Object.values(resolvedIdById));
  console.log(`Live products: ${productsSnap.docs.length} docs, ${liveProductIds.size} survivors`);

  // 3. counts source: stored snapshot rows
  console.log('counts source: stored snapshot rows');
  const storedProductItems = await loadItems(targetRef, target);
  console.log(`Stored product items: ${storedProductItems.length}`);

  // 4. Load live area items for productId lookup (counts come from stored snapshot)
  console.log('Loading live area items for product link lookup...');
  const allLiveAreaItems = await loadAreaItems(db, venueId, deptId);
  const liveItemsById = new Map();
  for (const item of allLiveAreaItems) {
    if (item._id) liveItemsById.set(item._id, item.productId ?? null);
  }

  // 5. Build raw items: stored counts + live productIds
  const { rawItems: rawAreaItems, noLiveItemCount } = buildRawItemsFromStoredSync(storedProductItems, liveItemsById, target.itemsGranularity);
  console.log(`Area rows: ${rawAreaItems.length}  No live area item: ${noLiveItemCount}`);

  // 6. Aggregate to product-level
  const { products: targetItems, areaRowCount, nameDuplicates, nameToProductId } = aggregateAreaItemsToProducts(rawAreaItems, liveProductIds, resolvedIdById);
  console.log(`Products: ${targetItems.length}  Name duplicates: ${nameDuplicates}`);

  // Print same-name distinct products (allowed — both are real distinct products)
  if (nameDuplicates > 0) {
    const nameGroups = new Map();
    for (const p of targetItems) {
      const n = normaliseName(p.name);
      if (!nameGroups.has(n)) nameGroups.set(n, []);
      nameGroups.get(n).push(p);
    }
    console.log('\nSame-name distinct products:');
    for (const [n, items] of nameGroups) {
      if (items.length > 1) {
        const ids = items.map(i => `${i.productId ?? '(name-keyed)'} (${i.actualClosing})`).join(', ');
        console.log(`  "${n}": ${ids}`);
      }
    }
  }

  // Link stats (at raw area row level)
  let linkedByLiveItem = 0;
  let linkedByName = 0;
  let unlinked = 0;
  for (const rawItem of rawAreaItems) {
    if (rawItem.productId != null) {
      linkedByLiveItem++;
    } else if (nameToProductId.has(normaliseName(rawItem.name))) {
      linkedByName++;
    } else {
      unlinked++;
    }
  }
  console.log(`\nRows linked via live area item: ${linkedByLiveItem}`);
  console.log(`Rows linked by name: ${linkedByName}`);
  console.log(`Rows unlinked: ${unlinked}`);

  // Cost enrichment: use product doc's costPrice for linked items; stored row fallback
  let costedFromProductDoc = 0;
  let costedFromStoredRow = 0;
  let uncostedCount = 0;
  for (const product of targetItems) {
    const docCost = product.productId != null ? (prodById[product.productId]?.costPrice ?? null) : null;
    if (docCost != null) {
      product.costPrice = docCost;
      costedFromProductDoc++;
    } else if (product.costPrice != null) {
      costedFromStoredRow++;
    } else {
      uncostedCount++;
    }
  }
  console.log(`\nCost source — product doc: ${costedFromProductDoc}, stored row: ${costedFromStoredRow}, uncosted: ${uncostedCount}`);

  // 7. Find most recent previous snapshot as baseline
  const snapsRef = db.collection(`venues/${venueId}/departments/${deptId}/snapshots`);
  const earlierSnap = await snapsRef
    .where('cycleNumber', '<', cycleNumber)
    .orderBy('cycleNumber', 'desc')
    .limit(1)
    .get();

  let baselineItems = [];
  let baseCycleNumber = null;
  if (!earlierSnap.empty) {
    const baselineDoc = earlierSnap.docs[0];
    const baselineData = baselineDoc.data();
    baseCycleNumber = baselineData.cycleNumber;
    const rawBaselineItems = await loadItems(baselineDoc.ref, baselineData);
    // Aggregate legacy per-area baseline to product-level
    baselineItems = toProductItemsForRepair(rawBaselineItems, baselineData.itemsGranularity)
      .filter(it => it.varianceReliable !== false);
    console.log(`Baseline: cycle-${baseCycleNumber} (${baselineItems.length} reliable product items)`);
  } else {
    console.log('No earlier snapshot found — all items will have no baseline (openingCount null).');
  }

  // 8. Compute repaired items using baseline
  const repairedItems = repairItems(targetItems, baselineItems, baseCycleNumber);

  // André Clouet dry-run detail (per spec: show item with areas, actual, opening, variance)
  const andreItem = repairedItems.find(it => normaliseName(it.name) === 'andré clouet');
  if (andreItem) {
    console.log('\nAndré Clouet item:');
    console.log(`  productId: ${andreItem.productId ?? 'null'}`);
    console.log(`  actualClosing: ${andreItem.actualClosing}  openingCount: ${andreItem.openingCount ?? 'null'}  variance: ${andreItem.totalVarianceQty}`);
    console.log(`  areas (${(andreItem.areas || []).length}):`);
    for (const a of (andreItem.areas || [])) {
      console.log(`    ${a.areaName ?? a.areaId}: ${a.actualClosing} (areaItemId: ${a.areaItemId ?? 'null'})`);
    }
  }

  // Stats
  const hasPrices = repairedItems.some(it => it.costPrice != null);
  const totalStockValue = hasPrices
    ? repairedItems.filter(it => it.costPrice != null).reduce((s, it) => s + it.actualClosing * it.costPrice, 0)
    : null;

  const gstBasis = target.costPriceIncludesGst ? 'inc-GST' : 'ex-GST';
  console.log(`\nStock value: ${fmtDollars(totalStockValue)} (${gstBasis})`);

  // Abort if stock value is n/a but catalogue has costed products
  if (totalStockValue === null && Object.values(prodById).some(p => p.costPrice != null)) {
    console.error('Abort: stock value is n/a but product catalogue has costed items — check product link resolution.');
    process.exit(1);
  }

  const shortages = repairedItems.filter(it => it.openingCount != null && it.unexplainedVarianceQty < 0)
    .sort((a, b) => a.unexplainedVarianceQty - b.unexplainedVarianceQty);
  const excesses  = repairedItems.filter(it => it.openingCount != null && it.unexplainedVarianceQty > 0)
    .sort((a, b) => b.unexplainedVarianceQty - a.unexplainedVarianceQty);
  const totalShortage = shortages.reduce((s, it) => s + Math.abs(it.unexplainedVarianceDollars ?? 0), 0);
  const totalExcess   = excesses.reduce((s, it) => s + Math.abs(it.unexplainedVarianceDollars ?? 0), 0);

  console.log(`Shortages: ${fmtDollars(-totalShortage)}  Excess: ${fmtDollars(totalExcess)}`);
  console.log('\nTop 10 shortages:');
  shortages.slice(0, 10).forEach(it => console.log(`  ${it.name}: ${it.unexplainedVarianceQty} (${fmtDollars(it.unexplainedVarianceDollars)})`));
  console.log('\nTop 10 excesses:');
  excesses.slice(0, 10).forEach(it => console.log(`  ${it.name}: +${it.unexplainedVarianceQty} (${fmtDollars(it.unexplainedVarianceDollars)})`));

  // 8. JSON backup
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = path.join(
    outputDir,
    `from-stored-${venueId.slice(0, 8)}-${deptId}-cycle${cycleNumber}-${Date.now()}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify({
    venueId, deptId, cycleNumber, baseCycleNumber, areaRowCount,
    productCount: repairedItems.length,
    totalStockValue,
    totalShortage: -totalShortage,
    totalExcess,
    originalItems: rawAreaItems,
    repairedItems,
  }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  if (!execute) {
    console.log('\nDry run complete. Pass --execute to write to Firestore.');
    return;
  }

  // 9. Write corrected snapshot
  const repairedSummary = recomputeSummary(repairedItems, target.summary || {});
  repairedSummary.areaRowsCounted = areaRowCount;

  const CHUNK_SIZE = 200;
  const newChunkCount = Math.ceil(repairedItems.length / CHUNK_SIZE);
  const oldChunkCount = target.itemChunkCount ?? 0;

  const repairedSnapshot = {
    ...target,
    items: repairedItems.slice(0, CHUNK_SIZE),
    itemCount: repairedItems.length,
    itemChunkCount: newChunkCount,
    itemsGranularity: 'product',
    summary: repairedSummary,
    baselineCycleNumber: baseCycleNumber ?? null,
    repairedAt: new Date().toISOString(),
    repairedFrom: baseCycleNumber != null ? `cycle-${baseCycleNumber}` : null,
    repairNote: `Rebuilt from stored area rows by --from-stored repair script`,
  };

  const batch = db.batch();
  batch.set(targetRef, repairedSnapshot);
  const chunksRef = targetRef.collection('itemChunks');
  for (let i = 0; i < newChunkCount; i++) {
    const chunkId = String(i).padStart(3, '0');
    batch.set(chunksRef.doc(chunkId), { index: i, items: repairedItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
  }
  for (let i = newChunkCount; i < oldChunkCount; i++) {
    batch.delete(chunksRef.doc(String(i).padStart(3, '0')));
  }
  await batch.commit();
  console.log(`\n✓ Snapshot cycle-${cycleNumber} rebuilt from stored area rows (${repairedItems.length} products, ${areaRowCount} area rows).`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n── Snapshot repair ──────────────────────────────────────────────`);
  console.log(`venue=${venueId}  dept=${deptId}  cycle=${cycleNumber}  execute=${execute}  fromStored=${fromStored ?? false}`);

  if (fromStored) {
    await mainFromStored();
    return;
  }

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

  // 3. Load full items (via chunks when present)
  const originalItems = await loadItems(targetRef, target);
  const baselineItems = await loadItems(baselineDoc.ref, baseline);

  const targetClaimedCount  = target.itemCount  ?? target.summary?.totalItemsCounted  ?? null;
  const baselineClaimedCount = baseline.itemCount ?? baseline.summary?.totalItemsCounted ?? null;

  if (targetClaimedCount != null && targetClaimedCount > originalItems.length) {
    console.error(
      `\nAbort: target claims ${targetClaimedCount} items but only ${originalItems.length} loaded.` +
      ` Partial item list would corrupt totalItemsCounted/stock value. Check itemChunks subcollection.`,
    );
    process.exit(1);
  }
  if (baselineClaimedCount != null && baselineClaimedCount > baselineItems.length) {
    console.error(
      `\nAbort: baseline claims ${baselineClaimedCount} items but only ${baselineItems.length} loaded.` +
      ` Cannot repair from incomplete baseline. Check itemChunks subcollection.`,
    );
    process.exit(1);
  }

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
  const CHUNK_SIZE = 200;
  const newChunkCount = Math.ceil(repairedItems.length / CHUNK_SIZE);
  const oldChunkCount = target.itemChunkCount ?? 0;

  const repairedSnapshot = {
    ...target,
    items: repairedItems.slice(0, CHUNK_SIZE),  // legacy field capped at 200
    itemCount: repairedItems.length,
    itemChunkCount: newChunkCount,
    summary: repairedSummary,
    baselineCycleNumber: baseCycleNumber,
    baselineGapNote: target.baselineGapNote ?? null,
    repairedAt: new Date().toISOString(),
    repairedFrom: `cycle-${baseCycleNumber}`,
    repairNote: `Baseline corrected from ${target.baselineCycleNumber ?? 'none'} to cycle-${baseCycleNumber} by repair script`,
  };

  const batch = db.batch();
  batch.set(targetRef, repairedSnapshot);

  const chunksRef = targetRef.collection('itemChunks');
  for (let i = 0; i < newChunkCount; i++) {
    const chunkId = String(i).padStart(3, '0');
    batch.set(chunksRef.doc(chunkId), {
      index: i,
      items: repairedItems.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    });
  }
  for (let i = newChunkCount; i < oldChunkCount; i++) {
    batch.delete(chunksRef.doc(String(i).padStart(3, '0')));
  }

  await batch.commit();
  console.log(`\n✓ Snapshot cycle-${cycleNumber} written (${newChunkCount} chunk(s)) with baseline from cycle-${baseCycleNumber}.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { loadItems, repairItems, recomputeSummary, productKey, toProductItemsForRepair, aggregateAreaItemsToProducts, resolveProductChainJs, buildRawItemsFromStoredSync };
