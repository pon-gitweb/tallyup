/**
 * preview-weekly-ledger.js  –  READ-ONLY weekly ledger preview.
 *
 * Usage:
 *   node scripts/admin/preview-weekly-ledger.js [--venue VENUE_ID]
 *   node scripts/admin/preview-weekly-ledger.js --test   (self-test, no Firebase)
 *
 * Authorised venue: O9pChydjz75nwpWA81KO
 * The script refuses to run against any other venue.
 *
 * Safety:
 *   - No writes, no deletes, no Firebase Auth calls.
 *   - All Firestore queries are single-collection fetches with at most a
 *     single-field orderBy — no composite indexes required.
 *   - Product names are printed only in the top-10 / top-15 and stagnant lists.
 *   - All other output is aggregate / numeric only.
 *   - Timestamps are rendered in Pacific/Auckland local time.
 *
 * Index notes:
 *   salesReports: fetched in full (no where/orderBy), filtered and sorted
 *     in memory.  This avoids the composite index that
 *     where('status','==').orderBy('periodStart') would require.
 *   salesReportMatches: deterministic-ID getDoc first; fallback is a single
 *     equality where('reportId','==',id) with no orderBy — safe on the
 *     auto single-field index.
 *   snapshots: orderBy('cycleNumber') is a single-field orderBy with no
 *     where clause — Firestore auto-indexes every field, so this is safe.
 */

'use strict';

// ── Self-test mode (no Firebase) ────────────────────────────────────────────

if (process.argv.includes('--test')) {
  runSelfTest();
  process.exit(0);
}

// ── Production mode ─────────────────────────────────────────────────────────

const admin = require('firebase-admin');

const AUTHORISED_VENUE = 'O9pChydjz75nwpWA81KO';
const NZ_TZ = 'Pacific/Auckland';

const vIdx = process.argv.indexOf('--venue');
const VENUE_ID = vIdx !== -1 ? process.argv[vIdx + 1] : AUTHORISED_VENUE;

if (VENUE_ID !== AUTHORISED_VENUE) {
  console.error(`\nERROR: This script is authorised for ${AUTHORISED_VENUE} only.\n`);
  process.exit(1);
}

// ── Auckland-time helpers ──────────────────────────────────────────────────

/** Firestore Timestamp or Date → 'YYYY-MM-DD' in Auckland time */
function toNZDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-CA', { timeZone: NZ_TZ }); // en-CA → YYYY-MM-DD
}

/** 'YYYY-MM-DD' → Monday of that calendar week (Mon–Sun), as 'YYYY-MM-DD' */
function weekMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const delta = dow === 0 ? 6 : dow - 1;
  return new Date(d - delta * 86_400_000).toISOString().slice(0, 10);
}

/** Monday → Sunday of the same week */
function weekSunday(mondayStr) {
  return new Date(new Date(mondayStr + 'T00:00:00Z').getTime() + 6 * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Number of calendar days between two YYYY-MM-DD strings (inclusive) */
function daySpan(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86_400_000
  ) + 1;
}

/**
 * Given a report period [startStr, endStr], return a map of
 * { weekMondayStr → dayCount } for every calendar week the period touches.
 */
function weekDayBreakdown(startStr, endStr) {
  const map = {};
  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  while (cur <= end) {
    const wk = weekMonday(cur.toISOString().slice(0, 10));
    map[wk] = (map[wk] || 0) + 1;
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return map;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function fmt$(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '$—';
}
function pct(num, denom) {
  return denom > 0 ? `${(num / denom * 100).toFixed(1)}%` : '—';
}
function pad(str, n) {
  return String(str).slice(0, n).padEnd(n);
}
function lpad(str, n) {
  return String(str).slice(0, n).padStart(n);
}
function hr() {
  return '━'.repeat(64);
}

// ── Line-type heuristic ───────────────────────────────────────────────────

/**
 * Classify a raw POS line name as one of:
 *   'dish', 'cocktail/drink', 'soft drink', 'category/modifier',
 *   'adjustment', 'possibly stock item'
 *
 * Used for the unmatched pareto to flag lines that are clearly not
 * inventory items and therefore won't benefit from product mapping.
 */
function classifyLine(name) {
  const n = (name || '').toLowerCase();

  if (/\b(open|void|refund|discount|coupon|comp|adjustment|misc|other|various)\b/.test(n))
    return 'adjustment';

  if (/\b(taco|pizza|burger|sandwich|wrap|salad|soup|curry|rice|steak|pork|beef|lamb|vege|vegan|bowl|plate|meal|dish|pasta|dumpling|sushi|ramen|noodle|kebab|bao|bun|roll|toast|waffle|pancake|omelette|omelette|scramble|benedict|eggs?|breakfast|lunch|dinner|brunch|dessert|cake|pudding|brownie|cheesecake|tiramisu|gelato|sorbet|crumble|ice cream)\b/.test(n)
    || /\(\s*\d+\s*pc[s]?\s*\)|\d\s*pc[s]?\b|\d\s*piece|\(\s*half\s*\)|\(\s*full\s*\)/i.test(n))
    return 'dish';

  if (/\b(classics?|platter|selection|variety|combo|package|deal|bucket|tasting|assorted|kids menu|children.s menu)\b/.test(n))
    return 'category/modifier';

  if (/\b(soft drink|softdrink|soft drinks|fizzy|cola|coke|pepsi|sprite|fanta|lemonade|soda water|tonic water|tonic|ginger ale|ginger beer|energy drink|red bull|monster|v drink|still water|sparkling water|mineral water)\b/.test(n))
    return 'soft drink';

  if (/\b(cocktail|mocktail|smoothie|juice|latte|espresso|cappuccino|flat white|long black|mocha|macchiato|americano|chai|hot chocolate|milkshake|frappe|slushie|shot|spirit|gin|vodka|rum|tequila|whisky|whiskey|bourbon|brandy|cognac|liqueur|schnapps|beer|lager|ale|ipa|stout|cider|draught|draft|tap|wine|rosé|champagne|prosecco|spritz|sangria|pimms|aperol|negroni|margarita|mojito|daiquiri|cosmopolitan|martini)\b/.test(n))
    return 'cocktail/drink';

  if (/\b(premium|regular|large|small|medium|mixed|menu|house|special|flight|board|kids|children)\b/.test(n)
    || /^[\w\s]+ (and|&) [\w\s]+$/.test(n))
    return 'category/modifier';

  return 'possibly stock item';
}

// ── In-memory partition of salesReports docs ──────────────────────────────

/**
 * Partition Firestore DocumentSnapshot[] from the salesReports collection.
 * Returns: { reports, prePeriod, supersededCount, noStatusCount }
 *
 * - superseded: status === 'superseded' — counted, excluded
 * - no status:  treated as active; counted in noStatusCount
 * - active (dated):   has a resolved start date; sorted ascending by periodStart
 * - active (undated): no start date; returned in prePeriod (listed separately)
 *
 * Each report object includes rawLines (the full NormalizedSalesLine[]) so
 * callers can aggregate total units across ALL lines (matched + unmatched).
 */
function partitionReports(allDocs) {
  let supersededCount = 0;
  let noStatusCount = 0;
  const activeDocs = [];

  for (const docSnap of allDocs) {
    const d = docSnap.data();
    if (d.status === 'superseded') { supersededCount++; continue; }
    if (!d.status) noStatusCount++;
    activeDocs.push(docSnap);
  }

  const mapped = activeDocs.map(docSnap => {
    const d = docSnap.data();
    const rawLines = d.report?.lines ?? d.lines ?? [];
    const totalRevenue = rawLines.reduce((s, l) => s + (l.gross ?? 0), 0);
    const totalQtySold = rawLines.reduce((s, l) => s + (l.qtySold ?? 0), 0);
    const startStr = d.report?.period?.start ?? toNZDate(d.periodStart);
    const endStr   = d.report?.period?.end   ?? toNZDate(d.periodEnd);
    const startMs  = d.periodStart?.toMillis?.() ??
                     (startStr ? new Date(startStr + 'T00:00:00Z').getTime() : null);
    return {
      id: docSnap.id,
      source: d.source ?? '?',
      startStr, endStr, startMs,
      days: startStr && endStr ? daySpan(startStr, endStr) : null,
      lineCount: rawLines.length,
      totalRevenue,
      totalQtySold,
      rawLines,  // kept for total-units-all and unmatched-pareto computation
      overlappingCycles: d.overlappingCycles ?? [],
      allocationMethod:  d.allocationMethod  ?? 'none',
      hasNoPeriod: !startStr,
    };
  });

  mapped.sort((a, b) => {
    if (a.startMs == null && b.startMs == null) return 0;
    if (a.startMs == null) return 1;
    if (b.startMs == null) return -1;
    return a.startMs - b.startMs;
  });

  return {
    reports:         mapped.filter(r => !r.hasNoPeriod),
    prePeriod:       mapped.filter(r =>  r.hasNoPeriod),
    supersededCount,
    noStatusCount,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  WEEKLY LEDGER PREVIEW  –  venue ${VENUE_ID}`);
  console.log(`  Read-only. Dates in Pacific/Auckland.`);
  console.log(`  Generated: ${new Date().toLocaleString('en-NZ', { timeZone: NZ_TZ })}`);
  console.log(`${'═'.repeat(64)}\n`);

  // ── 0: Fetch ALL salesReports in one call; partition in memory ───────────

  const allReportsSnap = await db
    .collection(`venues/${VENUE_ID}/salesReports`)
    .get();

  const { reports, prePeriod, supersededCount, noStatusCount } =
    partitionReports(allReportsSnap.docs);

  // ── 0b: Fetch salesReportMatches for each active dated report ────────────

  const matchesByReport = {};

  await Promise.all(reports.map(async r => {
    let matchDoc = await db
      .doc(`venues/${VENUE_ID}/salesReportMatches/${r.id}`)
      .get();

    if (!matchDoc.exists) {
      const q = await db
        .collection(`venues/${VENUE_ID}/salesReportMatches`)
        .where('reportId', '==', r.id)
        .limit(1)
        .get();
      if (!q.empty) matchDoc = q.docs[0];
    }

    if (!matchDoc.exists) { matchesByReport[r.id] = null; return; }

    const md = matchDoc.data();
    const matches = md.matches ?? [];
    const matchedRevenue = matches.reduce((s, m) => s + (m.gross   ?? 0), 0);
    const matchedQty     = matches.reduce((s, m) => s + (m.qtySold ?? 0), 0);
    matchesByReport[r.id] = {
      matched: md.counts?.matched ?? matches.length,
      total:   md.counts?.total   ?? r.lineCount,
      matchedRevenue, matchedQty, matches,
    };
  }));

  // ── 0c: Fetch department snapshots ──────────────────────────────────────

  const deptsSnap = await db
    .collection(`venues/${VENUE_ID}/departments`)
    .get();

  const allSnapshots = [];

  await Promise.all(deptsSnap.docs.map(async deptDoc => {
    const snapsSnap = await db
      .collection(`venues/${VENUE_ID}/departments/${deptDoc.id}/snapshots`)
      .orderBy('cycleNumber', 'asc')
      .get();
    for (const sDoc of snapsSnap.docs) {
      const s = sDoc.data();
      allSnapshots.push({
        departmentId:   deptDoc.id,
        departmentName: s.departmentName ?? deptDoc.data().name ?? deptDoc.id,
        cycleNumber:    s.cycleNumber,
        cycleStart:     toNZDate(s.cycleStart),
        cycleEnd:       toNZDate(s.cycleEnd),
        hasCycleStart:  !!s.cycleStart,
        items:          s.items ?? [],
      });
    }
  }));

  allSnapshots.sort((a, b) =>
    a.departmentId.localeCompare(b.departmentId) || a.cycleNumber - b.cycleNumber
  );

  // ── 0d: Build weekly aggregations ────────────────────────────────────────
  //
  // weekMap:           mondayStr → { units (matched), revenue (matched) }
  // allUnitsWeekMap:   mondayStr → { units (ALL lines in report, day-weighted) }
  // productMap:        productId → { name, totalUnits, totalRevenue,
  //                                  revenueIfUnitPrice, reportWeeks }
  //
  // revenueIfUnitPrice = sum(qty * gross * frac) — the revenue that WOULD
  // result if 'gross' is a per-unit price rather than total line revenue.
  // Comparing it to totalRevenue reveals whether gross appears to encode
  // total revenue (revenueIfUnitPrice >> totalRevenue) or unit price
  // (revenueIfUnitPrice ≈ totalRevenue * avgQty, clearly different scale).

  const weekMap          = new Map();
  const allUnitsWeekMap  = new Map();
  const productMap       = new Map();

  for (const r of reports) {
    const md = matchesByReport[r.id];
    if (!r.startStr || !r.endStr) continue;

    const totalDays = r.days;
    const wdMap = weekDayBreakdown(r.startStr, r.endStr);

    // ALL lines → allUnitsWeekMap
    for (const line of r.rawLines) {
      const qty = line.qtySold ?? 0;
      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        if (!allUnitsWeekMap.has(wk)) allUnitsWeekMap.set(wk, { units: 0 });
        allUnitsWeekMap.get(wk).units += qty * (daysInWk / totalDays);
      }
    }

    // MATCHED lines → weekMap and productMap
    if (!md) continue;
    for (const m of md.matches) {
      const pid   = m.productId;
      if (!pid) continue;
      const name  = m.productName ?? m.name ?? pid;
      const qty   = m.qtySold ?? 0;
      const gross = m.gross   ?? 0;

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        const frac  = daysInWk / totalDays;

        if (!weekMap.has(wk)) weekMap.set(wk, { units: 0, revenue: 0 });
        const wkE = weekMap.get(wk);
        wkE.units   += qty   * frac;
        wkE.revenue += gross * frac;

        if (!productMap.has(pid)) {
          productMap.set(pid, {
            name,
            totalUnits:          0,
            totalRevenue:        0,
            revenueIfUnitPrice:  0,
            reportWeeks:         new Set(),
          });
        }
        const pE = productMap.get(pid);
        pE.totalUnits          += qty   * frac;
        pE.totalRevenue        += gross * frac;
        pE.revenueIfUnitPrice  += qty * gross * frac; // if gross is per-unit price
        pE.reportWeeks.add(wk);
      }
    }
  }

  const sortedWeeks = [...weekMap.keys()].sort();

  // ── 0e: allWeeks set for gap detection ───────────────────────────────────

  const allWeeks = new Set();
  for (const r of reports) {
    if (!r.startStr || !r.endStr) continue;
    let cur = new Date(r.startStr + 'T00:00:00Z');
    const end = new Date(r.endStr + 'T00:00:00Z');
    while (cur <= end) {
      allWeeks.add(weekMonday(cur.toISOString().slice(0, 10)));
      cur = new Date(cur.getTime() + 7 * 86_400_000);
    }
  }

  // ── 0f: Latest counted stock from snapshots ──────────────────────────────

  const stockMap = {}; // productId → { count, cycleNumber }
  for (const s of allSnapshots) {
    for (const item of s.items) {
      if (!item.productId) continue;
      const existing = stockMap[item.productId];
      if (item.actualClosing != null &&
          (!existing || s.cycleNumber > existing.cycleNumber)) {
        stockMap[item.productId] = { count: item.actualClosing, cycleNumber: s.cycleNumber };
      }
    }
  }

  // ── 0g: Unmatched-line pareto (in-memory, no extra Firestore fetch) ───────
  //
  // For each report, subtract matched line names from rawLines to find
  // unmatched.  Matching uses lowercased trimmed name.  An unmatched line
  // is any rawLine whose name does not appear in the corresponding
  // salesReportMatches.matches[].name set.

  function normName(n) { return (n || '').toLowerCase().trim().replace(/\s+/g, ' '); }

  const unmatchedByName = new Map(); // normalised name → { origName, totalQty, reportCount }

  for (const r of reports) {
    const md = matchesByReport[r.id];
    const matchedNames = new Set(
      (md?.matches ?? []).map(m => normName(m.name ?? m.productName ?? ''))
    );
    for (const line of r.rawLines) {
      const nn = normName(line.name);
      if (!nn || matchedNames.has(nn)) continue;
      if (!unmatchedByName.has(nn)) {
        unmatchedByName.set(nn, { origName: line.name ?? nn, totalQty: 0, reportCount: 0 });
      }
      const u = unmatchedByName.get(nn);
      u.totalQty += line.qtySold ?? 0;
      u.reportCount++;
    }
  }

  const unmatchedTotal = [...unmatchedByName.values()].reduce((s, v) => s + v.totalQty, 0);
  const unmatchedSorted = [...unmatchedByName.entries()]
    .sort((a, b) => b[1].totalQty - a[1].totalQty);

  // ── 0h: Stagnant split: sold-out (stock=0) vs true stagnant (stock>0) ───

  const first6Set  = new Set(sortedWeeks.slice(0, 6));
  const last4Set   = new Set(sortedWeeks.slice(-4));
  const last4Start = sortedWeeks.length >= 4 ? sortedWeeks[sortedWeeks.length - 4] : null;

  const stagnant   = [];
  const soldOut    = [];
  for (const [pid, p] of productMap.entries()) {
    const inFirst6 = [...p.reportWeeks].some(w => first6Set.has(w));
    const inLast4  = [...p.reportWeeks].some(w => last4Set.has(w));
    if (!inFirst6 || inLast4) continue;
    const stock = stockMap[pid];
    if (stock != null && stock.count === 0) {
      soldOut.push([pid, p]);
    } else {
      stagnant.push([pid, p]);
    }
  }
  stagnant.sort((a, b) => b[1].totalUnits - a[1].totalUnits);
  soldOut.sort(  (a, b) => b[1].totalUnits - a[1].totalUnits);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Sales reports list
  // ═══════════════════════════════════════════════════════════════════════

  console.log(hr());
  console.log('1. ACTIVE SALES REPORTS');
  console.log(hr());
  console.log('');

  console.log(`  Total in salesReports collection: ${allReportsSnap.size}`);
  console.log(`    Active (dated)              : ${reports.length}`);
  if (prePeriod.length > 0)
    console.log(`    Active (pre-period-tracking): ${prePeriod.length}`);
  console.log(`    Superseded                  : ${supersededCount}`);
  if (noStatusCount > 0)
    console.log(`    ⚠  ${noStatusCount} doc(s) have no status field — treated as active`);
  console.log('');

  if (reports.length === 0) console.log('  No active dated reports found.');

  for (let i = 0; i < reports.length; i++) {
    const r  = reports[i];
    const md = matchesByReport[r.id];
    console.log(`  [${i + 1}] ${r.id}`);
    console.log(`      Period : ${r.startStr} → ${r.endStr}  (${r.days} days)`);
    console.log(`      Source : ${r.source}`);
    console.log(`      Lines  : ${r.lineCount}  |  Revenue: ${fmt$(r.totalRevenue)}`);
    if (md) {
      console.log(`      Matched: ${md.matched}/${md.total} lines (${pct(md.matched, md.total)})  |  ${fmt$(md.matchedRevenue)}/${fmt$(r.totalRevenue)} rev (${pct(md.matchedRevenue, r.totalRevenue)})`);
    } else {
      console.log('      Matched: ⚠ no salesReportMatches document found');
    }
    if (r.overlappingCycles.length) {
      console.log(`      Cycles : ${r.overlappingCycles.map(c => `cycle-${c.cycleNumber} dept=${c.departmentId.slice(0,8)} w=${c.weight?.toFixed(2) ?? '?'}`).join('; ')}`);
      console.log(`      Alloc  : ${r.allocationMethod}`);
    } else {
      console.log(`      Cycles : (none tagged)  Alloc: ${r.allocationMethod}`);
    }
    console.log('');
  }

  if (prePeriod.length > 0) {
    console.log(`  — Pre-period-tracking (${prePeriod.length} doc(s), excluded from ledger) —\n`);
    for (const r of prePeriod)
      console.log(`    ${r.id}  source=${r.source}  lines=${r.lineCount}  rev=${fmt$(r.totalRevenue)}`);
    console.log('');
  }

  console.log('  — Gap / overlap analysis —\n');

  const gapWeeks = [];
  const firstStart = reports.find(r => r.startStr)?.startStr;
  const lastEnd    = [...reports].reverse().find(r => r.endStr)?.endStr;
  if (firstStart && lastEnd) {
    let cur = new Date(weekMonday(firstStart) + 'T00:00:00Z');
    const end = new Date(lastEnd + 'T00:00:00Z');
    while (cur <= end) {
      const wk = cur.toISOString().slice(0, 10);
      if (!allWeeks.has(wk)) gapWeeks.push(wk);
      cur = new Date(cur.getTime() + 7 * 86_400_000);
    }
  }

  if (gapWeeks.length === 0 && reports.length > 0)
    console.log('  ✓ No gaps between the first and last report week.');
  else
    gapWeeks.forEach(wk => console.log(`  ✗ GAP  ${wk} – ${weekSunday(wk)}`));

  let overlapFound = false;
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const a = reports[i], b = reports[j];
      if (a.startStr && a.endStr && b.startStr && b.endStr &&
          a.startStr <= b.endStr && b.startStr <= a.endStr) {
        console.log(`  ✗ OVERLAP  [${i+1}] (${a.startStr}–${a.endStr}) overlaps [${j+1}] (${b.startStr}–${b.endStr})`);
        overlapFound = true;
      }
    }
  }
  if (!overlapFound && reports.length > 1) console.log('  ✓ No overlapping periods.');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: Stocktake linkage
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('2. STOCKTAKE LINKAGE');
  console.log(hr());
  console.log('');

  if (allSnapshots.length === 0) {
    console.log('  No department snapshots found.');
  } else {
    const byDept = {};
    for (const s of allSnapshots) (byDept[s.departmentId] = byDept[s.departmentId] || []).push(s);
    for (const snaps of Object.values(byDept)) {
      console.log(`  Dept: ${snaps[0].departmentName}  (${snaps[0].departmentId})`);
      for (const s of snaps) {
        const flag = s.hasCycleStart ? '' : '  ⚠ cycleStart MISSING';
        console.log(`    cycle-${s.cycleNumber}:  ${s.cycleStart ?? '(none)'} → ${s.cycleEnd ?? '?'}${flag}`);
      }
    }
  }

  console.log('\n  — Report → cycle linkage —\n');

  for (let i = 0; i < reports.length; i++) {
    const r     = reports[i];
    const label = `  [${i+1}] ${r.startStr ?? '?'}–${r.endStr ?? '?'}`;
    if (r.overlappingCycles.length > 0) {
      const mn =
        r.allocationMethod === 'exact_single_cycle'    ? 'exact single cycle' :
        r.allocationMethod === 'day_weighted_estimate' ? 'day-weighted across cycles' :
        r.allocationMethod;
      console.log(`${label}  →  ${r.overlappingCycles.length} cycle(s)  [${mn}]`);
      r.overlappingCycles.forEach(c =>
        console.log(`       cycle-${c.cycleNumber}  dept=${c.departmentId}  weight=${c.weight?.toFixed(3) ?? '?'}`)
      );
    } else {
      let reason;
      if (!r.startStr || !r.endStr) {
        reason = 'report has no period dates — cannot link';
      } else if (allSnapshots.length === 0) {
        reason = 'no stocktake snapshots exist for this venue';
      } else {
        const rEndMs  = new Date(r.endStr   + 'T00:00:00Z').getTime();
        const rStartMs= new Date(r.startStr + 'T00:00:00Z').getTime();
        const ends    = allSnapshots.filter(s => s.cycleEnd).map(s => new Date(s.cycleEnd   + 'T00:00:00Z').getTime());
        const starts  = allSnapshots.filter(s => s.cycleStart).map(s => new Date(s.cycleStart + 'T00:00:00Z').getTime());
        const latestEnd    = ends.length   ? Math.max(...ends)   : null;
        const earliestStart= starts.length ? Math.min(...starts) : null;
        if (earliestStart != null && rEndMs < earliestStart)
          reason = 'report pre-dates all cycle starts (report too old)';
        else if (latestEnd != null && rStartMs > latestEnd)
          reason = 'report is newer than all cycle ends (no cycle yet covers it)';
        else if (allSnapshots.some(s => !s.hasCycleStart))
          reason = 'overlapping cycle(s) lack cycleStart — allocation blocked';
        else
          reason = 'genuine gap — no cycle period covers this report';
      }
      console.log(`${label}  →  NO LINK  (${reason})`);
    }
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: Weekly ledger
  // ═══════════════════════════════════════════════════════════════════════

  console.log(hr());
  console.log('3. WEEKLY LEDGER  (matched lines, day-weighted across report period)');
  console.log(hr());
  console.log('');

  if (sortedWeeks.length === 0) {
    console.log('  No matched sales data found.');
  } else {
    console.log(`  ${sortedWeeks.length} calendar weeks (Mon–Sun):\n`);
    console.log(`  ${'Week (Mon–Sun)'.padEnd(25)}  ${'Units (est)'.padStart(12)}  ${'Revenue (est)'.padStart(14)}`);
    console.log(`  ${'-'.repeat(25)}  ${'-'.repeat(12)}  ${'-'.repeat(14)}`);
    for (const wk of sortedWeeks) {
      const { units, revenue } = weekMap.get(wk);
      console.log(`  ${`${wk} – ${weekSunday(wk)}`.padEnd(25)}  ${lpad(Math.round(units), 12)}  ${lpad(fmt$(revenue), 14)}`);
    }
    const tu = [...weekMap.values()].reduce((s, w) => s + w.units,   0);
    const tr = [...weekMap.values()].reduce((s, w) => s + w.revenue, 0);
    console.log(`  ${'-'.repeat(25)}  ${'-'.repeat(12)}  ${'-'.repeat(14)}`);
    console.log(`  ${'TOTAL'.padEnd(25)}  ${lpad(Math.round(tu), 12)}  ${lpad(fmt$(tr), 14)}`);
  }

  console.log('\n  — Top 10 products by units (whole period) —\n');
  const sortedProds = [...productMap.entries()].sort((a, b) => b[1].totalUnits - a[1].totalUnits);
  const top10 = sortedProds.slice(0, 10);
  if (top10.length === 0) {
    console.log('  No matched products.');
  } else {
    console.log(`  ${'#'.padStart(2)}  ${'Product'.padEnd(38)}  ${'Units'.padStart(8)}  ${'Revenue'.padStart(12)}`);
    console.log(`  ${'--'}  ${'-------'.padEnd(38)}  ${'-----'.padStart(8)}  ${'-------'.padStart(12)}`);
    top10.forEach(([, v], idx) =>
      console.log(`  ${String(idx+1).padStart(2)}  ${pad(v.name,38)}  ${lpad(Math.round(v.totalUnits),8)}  ${lpad(fmt$(v.totalRevenue),12)}`)
    );
  }

  const first6end = weekSunday(sortedWeeks[5] ?? sortedWeeks[sortedWeeks.length-1] ?? '?');
  console.log(`\n  — Stagnant / sold-out (first 6 wks ${sortedWeeks[0]??'?'}–${first6end}, absent last 4 wks ${last4Start??'?'}+) —\n`);
  console.log('  Note: absence = not in any report whose period overlaps the last-4-weeks');
  console.log('  window. Day-weighting does not prove week-by-week zero sales.\n');

  // True stagnant (stock > 0 or unknown)
  if (stagnant.length === 0 && soldOut.length === 0) {
    console.log('  None detected.');
  } else {
    if (soldOut.length > 0) {
      console.log(`  SOLD-OUT candidates (${soldOut.length}) — latest stock = 0, see Section 6d:\n`);
      console.log(`  ${'Product'.padEnd(38)}  ${'Hist.Units'.padStart(10)}`);
      soldOut.slice(0, 10).forEach(([, p]) =>
        console.log(`  ${pad(p.name,38)}  ${lpad(Math.round(p.totalUnits),10)}`)
      );
      if (soldOut.length > 10) console.log(`  … and ${soldOut.length-10} more (see §6d)`);
      console.log('');
    }
    if (stagnant.length > 0) {
      console.log(`  True stagnant (${stagnant.length}) — stock > 0 or unknown:\n`);
      console.log(`  ${'Product'.padEnd(38)}  ${'Hist.Units'.padStart(10)}  ${'Latest stock'.padStart(12)}`);
      console.log(`  ${'-------'.padEnd(38)}  ${'---------'.padStart(10)}  ${'------------'.padStart(12)}`);
      stagnant.slice(0, 25).forEach(([pid, p]) => {
        const stock    = stockMap[pid];
        const stockStr = stock != null ? String(stock.count) : '—';
        console.log(`  ${pad(p.name,38)}  ${lpad(Math.round(p.totalUnits),10)}  ${lpad(stockStr,12)}`);
      });
      if (stagnant.length > 25) console.log(`  … and ${stagnant.length-25} more`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Budget preview
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('4. BUDGET PREVIEW');
  console.log(hr());
  console.log('');
  console.log('  NOTE: Revenue is as exported (GST status unknown).\n');

  const todayNZ        = new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ });
  const currentWeekMon = weekMonday(todayNZ);
  const lastFullWeekMon = new Date(
    new Date(currentWeekMon + 'T00:00:00Z').getTime() - 7 * 86_400_000
  ).toISOString().slice(0, 10);

  const completeWeeks = sortedWeeks.filter(w => w < currentWeekMon);
  const last4Budget   = completeWeeks.slice(-4);
  const lastWeekRev   = weekMap.get(lastFullWeekMon)?.revenue ?? null;
  const avg4 = last4Budget.length > 0
    ? last4Budget.reduce((s, w) => s + (weekMap.get(w)?.revenue ?? 0), 0) / last4Budget.length
    : null;

  if (lastWeekRev != null) {
    console.log(`  Last full week  ${lastFullWeekMon} – ${weekSunday(lastFullWeekMon)}: ${fmt$(lastWeekRev)}`);
    [25,28,30].forEach(p => console.log(`    ${p}% = ${fmt$(lastWeekRev * p / 100)}`));
  } else {
    console.log(`  Last full week (${lastFullWeekMon}–${weekSunday(lastFullWeekMon)}): no matched sales data.`);
  }
  console.log('');
  if (avg4 != null) {
    console.log(`  Average of last ${last4Budget.length} complete week(s): ${fmt$(avg4)}`);
    console.log(`    (${last4Budget.join(', ')})`);
    [25,28,30].forEach(p => console.log(`    ${p}% = ${fmt$(avg4 * p / 100)}`));
  } else {
    console.log('  Not enough complete weeks for a 4-week average.');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: Coverage summary + data quality
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('5. COVERAGE SUMMARY & DATA QUALITY');
  console.log(hr());
  console.log('');

  const totalRepRev    = reports.reduce((s, r) => s + r.totalRevenue, 0);
  const totalMatchRev  = Object.values(matchesByReport).reduce((s, m) => s + (m?.matchedRevenue ?? 0), 0);
  const totalRepLines  = reports.reduce((s, r) => s + r.lineCount, 0);
  const totalMatchLines= Object.values(matchesByReport).reduce((s, m) => s + (m?.matched ?? 0), 0);
  const noMatchCount   = Object.values(matchesByReport).filter(m => m === null).length;
  const dateRange = reports.length > 0
    ? `${reports[0].startStr} → ${reports[reports.length-1].endStr}` : '—';

  console.log(`  Active reports           : ${reports.length}  (+${prePeriod.length} pre-period, +${supersededCount} superseded)`);
  console.log(`  Date range               : ${dateRange}`);
  console.log(`  Calendar weeks covered   : ${sortedWeeks.length}${gapWeeks.length > 0 ? `  (⚠ ${gapWeeks.length} gap week(s))` : ''}`);
  console.log(`  Snapshots found          : ${allSnapshots.length}  (${deptsSnap.size} dept(s))`);
  console.log(`  Reported revenue         : ${fmt$(totalRepRev)}`);
  console.log(`  Matched revenue          : ${fmt$(totalMatchRev)}  (${pct(totalMatchRev, totalRepRev)})`);
  console.log(`  Reported lines           : ${totalRepLines}`);
  console.log(`  Matched lines            : ${totalMatchLines}  (${pct(totalMatchLines, totalRepLines)})`);
  console.log(`  Reports without matches  : ${noMatchCount}`);
  console.log(`  Distinct matched products: ${productMap.size}`);
  console.log(`  Stagnant candidates      : ${stagnant.length}  (true stagnant)`);
  console.log(`  Sold-out candidates      : ${soldOut.length}`);
  console.log('');

  const issues = [];
  const lmf = totalRepLines > 0 ? totalMatchLines / totalRepLines : 1;
  const rmf = totalRepRev   > 0 ? totalMatchRev   / totalRepRev   : 1;

  if (lmf < 0.70) issues.push({ sev: 0, label: 'CRITICAL',
    title: `Low match rate: ${pct(totalMatchLines, totalRepLines)} of lines matched`,
    detail: `${totalRepLines - totalMatchLines} unmatched lines excluded from ledger and budget. Priority: run matcher and resolve salesReportUnknowns.` });
  else if (lmf < 0.85) issues.push({ sev: 1, label: 'HIGH',
    title: `Moderate match rate: ${pct(totalMatchLines, totalRepLines)} of lines matched`,
    detail: `${totalRepLines - totalMatchLines} unmatched lines. Resolve unknowns to improve ledger accuracy.` });

  if (rmf < 0.80) issues.push({ sev: 1, label: 'HIGH',
    title: `Revenue match gap: ${pct(totalMatchRev, totalRepRev)} matched`,
    detail: `${fmt$(totalRepRev - totalMatchRev)} on unmatched lines. Budget figures (§4) are understated.` });

  if (gapWeeks.length >= 4) issues.push({ sev: 0, label: 'CRITICAL',
    title: `${gapWeeks.length} gap week(s) with no sales data`,
    detail: `First 3: ${gapWeeks.slice(0,3).join(', ')}. 4-week averages are distorted; upload missing reports.` });
  else if (gapWeeks.length > 0) issues.push({ sev: 2, label: 'MEDIUM',
    title: `${gapWeeks.length} gap week(s)`,
    detail: `Missing: ${gapWeeks.join(', ')}.` });

  if (noMatchCount > 0) issues.push({ sev: 1, label: 'HIGH',
    title: `${noMatchCount} report(s) have no salesReportMatches doc`,
    detail: `All lines from these reports are absent from the ledger. Re-trigger the matcher.` });

  const noStartSnaps = allSnapshots.filter(s => !s.hasCycleStart);
  if (noStartSnaps.length > 0) issues.push({ sev: 2, label: 'MEDIUM',
    title: `${noStartSnaps.length} snapshot(s) missing cycleStart`,
    detail: noStartSnaps.map(s => `cycle-${s.cycleNumber} (${s.departmentName})`).join(', ') + '. Allocation defaults to none.' });

  const unlinked = reports.filter(r => r.overlappingCycles.length === 0);
  if (unlinked.length > 0) issues.push({ sev: 2, label: 'MEDIUM',
    title: `${unlinked.length} report(s) not linked to any stocktake cycle`,
    detail: 'Sales cannot be attributed to a variance period without a cycle link.' });

  if (supersededCount > 5) issues.push({ sev: 3, label: 'LOW',
    title: `${supersededCount} superseded reports`,
    detail: 'May indicate repeated re-uploads. Verify the active set is the final state.' });

  issues.sort((a, b) => a.sev - b.sev);
  console.log('  Three biggest data-quality problems:\n');
  if (issues.length === 0) {
    console.log('  No significant issues detected.');
  } else {
    issues.slice(0, 3).forEach((iss, i) => {
      console.log(`  #${i+1} [${iss.label}]  ${iss.title}`);
      const words = iss.detail.split(' ');
      let line = '         ';
      words.forEach(w => { if (line.length + w.length > 72) { console.log(line); line = '         '; } line += w + ' '; });
      if (line.trim()) console.log(line);
      console.log('');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6a: MONEY SANITY
  // ═══════════════════════════════════════════════════════════════════════

  console.log(hr());
  console.log('6a. MONEY SANITY  –  top 15 products by units');
  console.log(hr());
  console.log('');
  console.log('  "Stored rev/wk" = totalRevenue ÷ weeks present (avg).  "Gross/unit" =');
  console.log('  totalRevenue ÷ totalUnits.  If gross was total revenue (normal), this');
  console.log('  equals the implied unit price.  If it is cents rather than dollars,');
  console.log('  the gross field may contain a per-unit price instead of total revenue.');
  console.log('');

  const top15 = sortedProds.slice(0, 15);

  if (top15.length === 0) {
    console.log('  No matched products.');
  } else {
    // Assess gross/unit for each
    const ratios = top15.map(([, p]) =>
      p.totalUnits > 0 ? p.totalRevenue / p.totalUnits : null
    ).filter(r => r != null);
    const plausible = ratios.filter(r => r >= 0.50 && r <= 500).length;
    const isLikelyTotalRevenue = plausible >= Math.ceil(ratios.length * 0.6);
    const isLikelyUnitPrice    = ratios.filter(r => r < 0.50).length >= Math.ceil(ratios.length * 0.6);

    if (isLikelyTotalRevenue) {
      console.log('  ✓ Gross/unit is in a plausible F&B range for most lines — gross appears');
      console.log('    to be TOTAL LINE REVENUE (i.e., gross = qty × unit price).  The');
      console.log('    "gross/unit" column below is the implied unit price.');
    } else if (isLikelyUnitPrice) {
      console.log('  ⚠ Gross/unit is < $0.50 for most lines — the stored "gross" may be a');
      console.log('    UNIT PRICE, not total revenue.  Revenue would be understated.');
      console.log('    "Recomputed rev" = qty × gross is shown alongside stored values.');
    } else {
      console.log('  ? Mixed gross/unit ratios — cannot reliably determine whether gross');
      console.log('    represents total revenue or a unit price. Review individually.');
    }

    console.log('');
    const hdr = `  ${'Product'.padEnd(32)}  ${'Units'.padStart(8)}  ${'RevStored/wk'.padStart(14)}  ${'Gross/unit'.padStart(10)}`;
    const hdr2 = isLikelyUnitPrice ? hdr + `  ${'Rev×qty/wk'.padStart(12)}` : hdr;
    console.log(hdr2);
    console.log('  ' + '-'.repeat(isLikelyUnitPrice ? 84 : 70));

    for (const [, p] of top15) {
      const weeksPresent = p.reportWeeks.size || 1;
      const revPerWk = p.totalRevenue / weeksPresent;
      const grossPerUnit = p.totalUnits > 0 ? p.totalRevenue / p.totalUnits : null;
      const revIfUnitPricePerWk = p.revenueIfUnitPrice / weeksPresent;
      let row = `  ${pad(p.name, 32)}  ${lpad(Math.round(p.totalUnits), 8)}  ${lpad(fmt$(revPerWk), 14)}  ${lpad(grossPerUnit != null ? fmt$(grossPerUnit) : '$—', 10)}`;
      if (isLikelyUnitPrice) row += `  ${lpad(fmt$(revIfUnitPricePerWk), 12)}`;
      console.log(row);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6b: TOTAL UNITS PER WEEK (all lines + matched + match rate)
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('6b. TOTAL UNITS PER WEEK  (all lines vs matched; reads trends without coverage bias)');
  console.log(hr());
  console.log('');

  const allWeeksSorted = [...new Set([...weekMap.keys(), ...allUnitsWeekMap.keys()])].sort();

  if (allWeeksSorted.length === 0) {
    console.log('  No data.');
  } else {
    console.log(`  ${'Week'.padEnd(10)}  ${'All units'.padStart(11)}  ${'Matched'.padStart(9)}  ${'Match rate'.padStart(11)}  ${'Revenue (matched)'.padStart(17)}`);
    console.log(`  ${'-'.repeat(10)}  ${'-'.repeat(11)}  ${'-'.repeat(9)}  ${'-'.repeat(11)}  ${'-'.repeat(17)}`);
    for (const wk of allWeeksSorted) {
      const allU    = allUnitsWeekMap.get(wk)?.units   ?? 0;
      const matchU  = weekMap.get(wk)?.units   ?? 0;
      const matchR  = weekMap.get(wk)?.revenue ?? 0;
      console.log(
        `  ${wk.padEnd(10)}  ${lpad(Math.round(allU), 11)}  ${lpad(Math.round(matchU), 9)}  ${lpad(pct(matchU, allU), 11)}  ${lpad(fmt$(matchR), 17)}`
      );
    }
    const totalAllU   = [...allUnitsWeekMap.values()].reduce((s, v) => s + v.units, 0);
    const totalMatchU = [...weekMap.values()].reduce((s, v) => s + v.units, 0);
    const totalMatchR = [...weekMap.values()].reduce((s, v) => s + v.revenue, 0);
    console.log(`  ${'-'.repeat(10)}  ${'-'.repeat(11)}  ${'-'.repeat(9)}  ${'-'.repeat(11)}  ${'-'.repeat(17)}`);
    console.log(
      `  ${'TOTAL'.padEnd(10)}  ${lpad(Math.round(totalAllU), 11)}  ${lpad(Math.round(totalMatchU), 9)}  ${lpad(pct(totalMatchU, totalAllU), 11)}  ${lpad(fmt$(totalMatchR), 17)}`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6c: UNMATCHED PARETO
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('6c. UNMATCHED LINE PARETO  (computed in-memory from rawLines − matches)');
  console.log(hr());
  console.log('');

  if (unmatchedSorted.length === 0) {
    console.log('  All lines matched — no unmatched names found.');
  } else {
    // Find how many names cover 80% of unmatched units
    let cumQty = 0;
    let namesFor80Pct = 0;
    for (const [, v] of unmatchedSorted) {
      cumQty += v.totalQty;
      namesFor80Pct++;
      if (cumQty >= unmatchedTotal * 0.8) break;
    }

    console.log(`  Total unmatched names   : ${unmatchedByName.size}`);
    console.log(`  Total unmatched units   : ${Math.round(unmatchedTotal)}`);
    console.log(`  Names covering 80% of units: ${namesFor80Pct}`);
    console.log('');
    console.log(`  Top ${Math.min(30, unmatchedSorted.length)} by units:\n`);
    console.log(`  ${'Name'.padEnd(38)}  ${'Units'.padStart(8)}  ${'Cum%'.padStart(7)}  ${'Reports'.padStart(7)}  Type`);
    console.log(`  ${'----'.padEnd(38)}  ${'-----'.padStart(8)}  ${'----'.padStart(7)}  ${'-------'.padStart(7)}  ----`);

    let cumU = 0;
    let shown = 0;
    for (const [nn, v] of unmatchedSorted) {
      if (shown >= 30) break;
      cumU += v.totalQty;
      const cumPct   = unmatchedTotal > 0 ? `${(cumU / unmatchedTotal * 100).toFixed(1)}%` : '—';
      const typeTag  = classifyLine(v.origName);
      console.log(
        `  ${pad(v.origName, 38)}  ${lpad(Math.round(v.totalQty), 8)}  ${lpad(cumPct, 7)}  ${lpad(String(v.reportCount), 7)}  ${typeTag}`
      );
      shown++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6d: SOLD-OUT CANDIDATES
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('6d. SOLD-OUT CANDIDATES  (stagnant + latest counted stock = 0)');
  console.log(hr());
  console.log('');
  console.log('  Separate from true stagnant (§3): these products had historical sales');
  console.log('  in weeks 1–6, nothing in the last 4 weeks, AND the latest snapshot');
  console.log('  shows zero stock.  Likely discontinued or fully depleted.\n');

  if (soldOut.length === 0) {
    console.log('  None detected.');
  } else {
    console.log(`  ${soldOut.length} sold-out candidate(s):\n`);
    console.log(`  ${'Product'.padEnd(42)}  ${'Hist.Units'.padStart(10)}  ${'Last cycle'.padStart(10)}`);
    console.log(`  ${'-------'.padEnd(42)}  ${'---------'.padStart(10)}  ${'---------'.padStart(10)}`);
    for (const [pid, p] of soldOut) {
      const stock    = stockMap[pid];
      const cycleStr = stock != null ? `cycle-${stock.cycleNumber}` : '—';
      console.log(`  ${pad(p.name, 42)}  ${lpad(Math.round(p.totalUnits), 10)}  ${lpad(cycleStr, 10)}`);
    }
  }

  console.log('\n' + '═'.repeat(64));
  console.log('  END OF PREVIEW  –  no writes were made.');
  console.log('═'.repeat(64) + '\n');
}

main().catch(e => {
  console.error('\nScript error:', e?.message ?? e);
  process.exit(1);
});

// ── Self-test (node preview-weekly-ledger.js --test) ──────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) console.log(`        got: ${JSON.stringify(got)}\n   expected: ${JSON.stringify(expected)}`);
    ok ? pass++ : fail++;
  }
  function assertBool(label, got, expected) {
    assert(label, Boolean(got), Boolean(expected));
  }

  console.log('\nSelf-test: pure helpers\n');

  // weekMonday
  assert('weekMonday: Monday unchanged',         weekMonday('2024-10-07'), '2024-10-07');
  assert('weekMonday: Sunday → prior Monday',    weekMonday('2024-10-13'), '2024-10-07');
  assert('weekMonday: Wednesday',                weekMonday('2024-10-09'), '2024-10-07');
  assert('weekMonday: Saturday',                 weekMonday('2024-10-12'), '2024-10-07');
  assert('weekMonday: Jan 1 (Monday)',           weekMonday('2024-01-01'), '2024-01-01');
  assert('weekMonday: Jan 2 (Tuesday)',          weekMonday('2024-01-02'), '2024-01-01');

  // weekSunday
  assert('weekSunday: Mon → Sun',               weekSunday('2024-10-07'), '2024-10-13');
  assert('weekSunday: cross-month',             weekSunday('2024-09-30'), '2024-10-06');

  // daySpan
  assert('daySpan: same day = 1',              daySpan('2024-01-01','2024-01-01'), 1);
  assert('daySpan: two days = 2',              daySpan('2024-01-01','2024-01-02'), 2);
  assert('daySpan: one week = 7',              daySpan('2024-01-01','2024-01-07'), 7);

  // weekDayBreakdown
  assert('wdBreakdown: single full week = 7',
    weekDayBreakdown('2024-10-07','2024-10-13'), { '2024-10-07': 7 });
  const wdTwo = weekDayBreakdown('2024-10-09','2024-10-15');
  assert('wdBreakdown: Wed–Tue first week = 5',  wdTwo['2024-10-07'], 5);
  assert('wdBreakdown: Wed–Tue second week = 2', wdTwo['2024-10-14'], 2);
  assert('wdBreakdown: sum = span',
    Object.values(wdTwo).reduce((s,v)=>s+v,0), daySpan('2024-10-09','2024-10-15'));

  // partitionReports
  function fakeDoc(id, data) { return { id, data: () => data }; }
  const fakeDocs = [
    fakeDoc('r1', { status:'active',     periodStart:{toMillis:()=>new Date('2024-01-01').getTime()}, report:{period:{start:'2024-01-01',end:'2024-01-07'},lines:[]}}),
    fakeDoc('r2', { status:'superseded', periodStart:{toMillis:()=>new Date('2024-01-08').getTime()}, report:{period:{start:'2024-01-08',end:'2024-01-14'},lines:[]}}),
    fakeDoc('r3', { status:'active',     periodStart:{toMillis:()=>new Date('2024-02-01').getTime()}, report:{period:{start:'2024-02-01',end:'2024-02-07'},lines:[]}}),
    fakeDoc('r4', { /* no status */      report:{period:{start:'2024-01-15',end:'2024-01-21'},lines:[]}}),
    fakeDoc('r5', { status:'active',     /* no periodStart */                                         report:{period:{start:null,end:null},lines:[]}}),
  ];
  const pt = partitionReports(fakeDocs);
  assert('partition: supersededCount = 1',  pt.supersededCount, 1);
  assert('partition: noStatusCount = 1',    pt.noStatusCount,   1);
  assert('partition: prePeriod = 1',        pt.prePeriod.length, 1);
  assert('partition: prePeriod id = r5',    pt.prePeriod[0].id, 'r5');
  assert('partition: dated count = 3',      pt.reports.length,  3);
  assert('partition: sorted[0] = r1',       pt.reports[0].id, 'r1');
  assert('partition: sorted[1] = r4',       pt.reports[1].id, 'r4');
  assert('partition: sorted[2] = r3',       pt.reports[2].id, 'r3');

  // partitionReports: rawLines is stored
  const drWithLines = fakeDoc('rL', {
    status: 'active',
    periodStart: { toMillis: () => new Date('2024-03-01').getTime() },
    report: { period: { start: '2024-03-01', end: '2024-03-07' },
      lines: [{ name: 'Beer', qtySold: 10, gross: 50 }, { name: 'Wine', qtySold: 5, gross: 30 }] }
  });
  const ptL = partitionReports([drWithLines]);
  assert('partition: rawLines stored', ptL.reports[0].rawLines.length, 2);
  assert('partition: totalQtySold summed', ptL.reports[0].totalQtySold, 15);

  // Gap detection
  function buildAllWeeks(rList) {
    const s = new Set();
    for (const r of rList) {
      if (!r.startStr || !r.endStr) continue;
      let cur = new Date(r.startStr + 'T00:00:00Z');
      const end = new Date(r.endStr + 'T00:00:00Z');
      while (cur <= end) { s.add(weekMonday(cur.toISOString().slice(0,10))); cur = new Date(cur.getTime() + 7*86_400_000); }
    }
    return s;
  }
  const aw = buildAllWeeks([
    { startStr:'2024-01-01', endStr:'2024-01-07' },
    { startStr:'2024-01-22', endStr:'2024-01-28' },
  ]);
  assert('gap: Jan 1 present',  aw.has('2024-01-01'), true);
  assert('gap: Jan 8 absent',   aw.has('2024-01-08'), false);
  assert('gap: Jan 15 absent',  aw.has('2024-01-15'), false);
  assert('gap: Jan 22 present', aw.has('2024-01-22'), true);

  // Stagnant/sold-out split
  const weeks = ['2024-01-01','2024-01-08','2024-01-15','2024-01-22','2024-01-29','2024-02-05',
                 '2024-02-12','2024-02-19','2024-02-26','2024-03-04'];
  const f6 = new Set(weeks.slice(0,6));
  const l4 = new Set(weeks.slice(-4));
  function splitStagnant(pm, stockM, f6s, l4s) {
    const st = [], so = [];
    for (const [pid, p] of pm.entries()) {
      const inFirst6 = [...p.reportWeeks].some(w => f6s.has(w));
      const inLast4  = [...p.reportWeeks].some(w => l4s.has(w));
      if (!inFirst6 || inLast4) continue;
      const stock = stockM[pid];
      (stock != null && stock.count === 0 ? so : st).push(pid);
    }
    return { stagnant: st, soldOut: so };
  }
  const pm = new Map([
    ['pA', { totalUnits:10, reportWeeks: new Set(['2024-01-01']) }], // first6 only, stock 5 → stagnant
    ['pB', { totalUnits:5,  reportWeeks: new Set(['2024-01-01','2024-03-04']) }], // last4 too → neither
    ['pC', { totalUnits:3,  reportWeeks: new Set(['2024-01-08']) }], // first6 only, stock 0 → sold-out
    ['pD', { totalUnits:7,  reportWeeks: new Set(['2024-02-26']) }], // last4 only → neither
  ]);
  const sm = { pA: { count: 5, cycleNumber: 1 }, pC: { count: 0, cycleNumber: 1 } };
  const { stagnant: sg, soldOut: so } = splitStagnant(pm, sm, f6, l4);
  assert('stagnant: pA is stagnant', sg, ['pA']);
  assert('sold-out: pC is sold-out', so, ['pC']);

  // classifyLine
  assert('classify: "tacos" → dish',                 classifyLine('Beef Tacos'),         'dish');
  assert('classify: "(1pc)" → dish',                 classifyLine('Burger (1pc)'),        'dish');
  assert('classify: "cocktail" → cocktail/drink',    classifyLine('House Cocktail'),       'cocktail/drink');
  assert('classify: "soft drinks" → soft drink',     classifyLine('Soft Drinks'),          'soft drink');
  assert('classify: "classics" → category/modifier', classifyLine('Wine Classics'),        'category/modifier');
  assert('classify: "open food" → adjustment',       classifyLine('Open Food Item'),       'adjustment');
  assert('classify: "IPA beer" → cocktail/drink',    classifyLine('Hazy IPA Beer'),        'cocktail/drink');
  assert('classify: brand name → possibly stock',    classifyLine('Heineken 330ml'),       'possibly stock item');

  // Gross sanity: isLikelyUnitPrice flag logic
  function assessRatios(ratios) {
    const plausible       = ratios.filter(r => r >= 0.50 && r <= 500).length;
    const likelyTotal     = plausible   >= Math.ceil(ratios.length * 0.6);
    const likelyUnitPrice = ratios.filter(r => r < 0.50).length >= Math.ceil(ratios.length * 0.6);
    return { likelyTotal, likelyUnitPrice };
  }
  const a1 = assessRatios([5.0, 8.5, 12.0, 4.5, 7.0, 6.0, 9.5, 10.0, 3.5, 11.0]);
  assertBool('gross sanity: ratios $3-12 → likelyTotal',    a1.likelyTotal,     true);
  assertBool('gross sanity: ratios $3-12 → NOT likelyUnit', a1.likelyUnitPrice, false);
  const a2 = assessRatios([0.05, 0.08, 0.03, 0.07, 0.04, 0.06, 0.05, 0.09, 0.02, 0.10]);
  assertBool('gross sanity: ratios $0.02-0.10 → NOT likelyTotal', a2.likelyTotal,    false);
  assertBool('gross sanity: ratios $0.02-0.10 → likelyUnit',      a2.likelyUnitPrice, true);

  // normName deduplication (simulated)
  function normName(n) { return (n || '').toLowerCase().trim().replace(/\s+/g, ' '); }
  assert('normName: trims and lowercases', normName('  Beef Tacos  '), 'beef tacos');
  assert('normName: collapses spaces',     normName('hot  dog'),       'hot dog');
  assert('normName: empty stays empty',    normName(''),               '');

  console.log(`\n  ${pass} passed, ${fail} failed.\n`);
  if (fail > 0) process.exit(1);
}
