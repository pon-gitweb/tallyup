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
 *   - Product names are printed only in the top-10 and stagnant lists.
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

// ── In-memory partition of salesReports docs ──────────────────────────────

/**
 * Given an array of Firestore DocumentSnapshot objects from the salesReports
 * collection, partition them into { reports, supersededCount, noStatusCount,
 * prePeriodDocs }.
 *
 * - superseded: status === 'superseded'
 * - no status: treated as active; counted in noStatusCount
 * - active (dated): has a resolvedStartStr; sorted ascending by periodStart
 * - active (undated / pre-period-tracking): no start date; returned separately
 */
function partitionReports(allDocs) {
  let supersededCount = 0;
  let noStatusCount = 0;
  const activeDocs = [];

  for (const docSnap of allDocs) {
    const d = docSnap.data();
    if (d.status === 'superseded') {
      supersededCount++;
      continue;
    }
    if (!d.status) noStatusCount++;
    activeDocs.push(docSnap);
  }

  // Build report objects
  const mapped = activeDocs.map(docSnap => {
    const d = docSnap.data();
    const lines = d.report?.lines ?? d.lines ?? [];
    const totalRevenue = lines.reduce((s, l) => s + (l.gross ?? 0), 0);
    const startStr = d.report?.period?.start ?? toNZDate(d.periodStart);
    const endStr   = d.report?.period?.end   ?? toNZDate(d.periodEnd);
    // Millis for sorting; null → sort to end
    const startMs  = d.periodStart?.toMillis?.() ?? (startStr ? new Date(startStr + 'T00:00:00Z').getTime() : null);
    return {
      id: docSnap.id,
      source: d.source ?? '?',
      startStr,
      endStr,
      startMs,
      days: startStr && endStr ? daySpan(startStr, endStr) : null,
      lineCount: lines.length,
      totalRevenue,
      overlappingCycles: d.overlappingCycles ?? [],
      allocationMethod: d.allocationMethod ?? 'none',
      hasNoPeriod: !startStr,
    };
  });

  // Sort: dated ascending, undated to end
  mapped.sort((a, b) => {
    if (a.startMs == null && b.startMs == null) return 0;
    if (a.startMs == null) return 1;
    if (b.startMs == null) return -1;
    return a.startMs - b.startMs;
  });

  const reports     = mapped.filter(r => !r.hasNoPeriod);
  const prePeriod   = mapped.filter(r =>  r.hasNoPeriod);

  return { reports, prePeriod, supersededCount, noStatusCount };
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
  //
  // We do NOT use where().orderBy() here because that combination on two
  // different fields would require a composite index. A full collection
  // fetch is fine for ~a dozen documents.

  const allReportsSnap = await db
    .collection(`venues/${VENUE_ID}/salesReports`)
    .get();

  const { reports, prePeriod, supersededCount, noStatusCount } =
    partitionReports(allReportsSnap.docs);

  // ── 0b: Fetch salesReportMatches for each active dated report ────────────
  //
  // getDoc (deterministic ID = reportId) requires no index.
  // The fallback where('reportId','==',id) is a single-field equality with
  // no orderBy — safe on the auto single-field index Firestore creates by
  // default for every field.

  const matchesByReport = {}; // reportId → { matched, total, matchedRevenue, matches[] } | null

  await Promise.all(reports.map(async r => {
    // Shape B: Cloud Functions writer uses doc ID = reportId
    let matchDoc = await db
      .doc(`venues/${VENUE_ID}/salesReportMatches/${r.id}`)
      .get();

    // Shape A fallback: client writer uses auto-ID + reportId field
    if (!matchDoc.exists) {
      const q = await db
        .collection(`venues/${VENUE_ID}/salesReportMatches`)
        .where('reportId', '==', r.id)
        .limit(1)
        .get();
      if (!q.empty) matchDoc = q.docs[0];
    }

    if (!matchDoc.exists) {
      matchesByReport[r.id] = null;
      return;
    }

    const md = matchDoc.data();
    const matches = md.matches ?? [];
    const matchedRevenue = matches.reduce((s, m) => s + (m.gross ?? 0), 0);
    matchesByReport[r.id] = {
      matched: md.counts?.matched ?? matches.length,
      total:   md.counts?.total   ?? r.lineCount,
      matchedRevenue,
      matches,
    };
  }));

  // ── 0c: Fetch department snapshots ──────────────────────────────────────
  //
  // orderBy('cycleNumber','asc') is a single-field orderBy with no where
  // clause. Firestore auto-creates a single-field index for every field,
  // so this needs no composite index.

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

  // ── 0d: Build weekly aggregation (all matched lines, day-weighted) ───────

  const weekMap    = new Map(); // mondayStr → { units, revenue }
  const productMap = new Map(); // productId → { name, totalUnits, totalRevenue, reportWeeks }

  for (const r of reports) {
    const md = matchesByReport[r.id];
    if (!md || !r.startStr || !r.endStr) continue;

    const totalDays = r.days;
    const wdMap = weekDayBreakdown(r.startStr, r.endStr);

    for (const m of md.matches) {
      const pid = m.productId;
      if (!pid) continue;
      const name  = m.productName ?? m.name ?? pid;
      const qty   = m.qtySold ?? 0;
      const gross = m.gross   ?? 0;

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        const frac  = daysInWk / totalDays;
        const wkQty = qty   * frac;
        const wkRev = gross * frac;

        if (!weekMap.has(wk)) weekMap.set(wk, { units: 0, revenue: 0 });
        const wkEntry = weekMap.get(wk);
        wkEntry.units   += wkQty;
        wkEntry.revenue += wkRev;

        if (!productMap.has(pid)) {
          productMap.set(pid, { name, totalUnits: 0, totalRevenue: 0, reportWeeks: new Set() });
        }
        const pEntry = productMap.get(pid);
        pEntry.totalUnits   += wkQty;
        pEntry.totalRevenue += wkRev;
        pEntry.reportWeeks.add(wk);
      }
    }
  }

  const sortedWeeks = [...weekMap.keys()].sort();

  // ── 0e: allWeeks set for gap detection ───────────────────────────────────

  const allWeeks = new Set();
  for (const r of reports) {
    if (!r.startStr || !r.endStr) continue;
    let cur = new Date(r.startStr + 'T00:00:00Z');
    const end = new Date(r.endStr   + 'T00:00:00Z');
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

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Sales reports list
  // ═══════════════════════════════════════════════════════════════════════

  console.log(hr());
  console.log('1. ACTIVE SALES REPORTS');
  console.log(hr());
  console.log('');

  const totalActive = reports.length + prePeriod.length;
  console.log(`  Total documents in salesReports: ${allReportsSnap.size}`);
  console.log(`    Active (dated)          : ${reports.length}`);
  if (prePeriod.length > 0) {
    console.log(`    Active (pre-period-tracking, no start date): ${prePeriod.length}`);
  }
  console.log(`    Superseded              : ${supersededCount}`);
  if (noStatusCount > 0) {
    console.log(`    ⚠  ${noStatusCount} doc(s) have no status field — treated as active`);
  }
  console.log('');

  if (totalActive === 0) {
    console.log('  No active reports found.');
  }

  for (let i = 0; i < reports.length; i++) {
    const r  = reports[i];
    const md = matchesByReport[r.id];
    const matchedLines = md?.matched ?? 0;
    const matchedRev   = md?.matchedRevenue ?? 0;
    const matchPctLines = pct(matchedLines, md?.total ?? r.lineCount);
    const matchPctRev   = pct(matchedRev, r.totalRevenue);

    console.log(`  [${i + 1}] ${r.id}`);
    console.log(`      Period : ${r.startStr} → ${r.endStr}  (${r.days} days)`);
    console.log(`      Source : ${r.source}`);
    console.log(`      Lines  : ${r.lineCount}  |  Revenue: ${fmt$(r.totalRevenue)}`);
    if (md) {
      console.log(`      Matched: ${matchedLines}/${md.total} lines (${matchPctLines})  |  ${fmt$(matchedRev)}/${fmt$(r.totalRevenue)} rev (${matchPctRev})`);
    } else {
      console.log('      Matched: ⚠ no salesReportMatches document found');
    }
    if (r.overlappingCycles.length) {
      const cyclesStr = r.overlappingCycles
        .map(c => `cycle-${c.cycleNumber} dept=${c.departmentId.slice(0, 8)} w=${c.weight?.toFixed(2) ?? '?'}`)
        .join('; ');
      console.log(`      Cycles : ${cyclesStr}`);
      console.log(`      Alloc  : ${r.allocationMethod}`);
    } else {
      console.log(`      Cycles : (none tagged)  Alloc: ${r.allocationMethod}`);
    }
    console.log('');
  }

  if (prePeriod.length > 0) {
    console.log(`  — Pre-period-tracking (${prePeriod.length} doc(s), excluded from ledger) —\n`);
    for (const r of prePeriod) {
      console.log(`    ${r.id}  source=${r.source}  lines=${r.lineCount}  rev=${fmt$(r.totalRevenue)}`);
    }
    console.log('');
  }

  // Gap and overlap analysis
  console.log('  — Gap / overlap analysis —\n');

  const gapWeeks = [];
  if (reports.length > 0) {
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
  }

  if (gapWeeks.length === 0 && reports.length > 0) {
    console.log('  ✓ No gaps between the first and last report week.');
  } else {
    gapWeeks.forEach(wk => console.log(`  ✗ GAP  ${wk} – ${weekSunday(wk)}`));
  }

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
  if (!overlapFound && reports.length > 1) {
    console.log('  ✓ No overlapping periods.');
  }

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
    for (const s of allSnapshots) {
      (byDept[s.departmentId] = byDept[s.departmentId] || []).push(s);
    }
    for (const snaps of Object.values(byDept)) {
      console.log(`  Dept: ${snaps[0].departmentName}  (${snaps[0].departmentId})`);
      for (const s of snaps) {
        const startFlag = s.hasCycleStart ? '' : '  ⚠ cycleStart MISSING';
        console.log(`    cycle-${s.cycleNumber}:  ${s.cycleStart ?? '(none)'} → ${s.cycleEnd ?? '?'}${startFlag}`);
      }
    }
  }

  console.log('\n  — Report → cycle linkage —\n');

  for (let i = 0; i < reports.length; i++) {
    const r     = reports[i];
    const label = `  [${i+1}] ${r.startStr ?? '?'}–${r.endStr ?? '?'}`;

    if (r.overlappingCycles.length > 0) {
      const methodNote =
        r.allocationMethod === 'exact_single_cycle'   ? 'exact single cycle' :
        r.allocationMethod === 'day_weighted_estimate' ? 'day-weighted across cycles' :
        r.allocationMethod;
      console.log(`${label}  →  ${r.overlappingCycles.length} cycle(s)  [${methodNote}]`);
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
        const rEndMs   = new Date(r.endStr   + 'T00:00:00Z').getTime();
        const rStartMs = new Date(r.startStr + 'T00:00:00Z').getTime();
        const cycleEnds   = allSnapshots.filter(s => s.cycleEnd).map(s => new Date(s.cycleEnd   + 'T00:00:00Z').getTime());
        const cycleStarts = allSnapshots.filter(s => s.cycleStart).map(s => new Date(s.cycleStart + 'T00:00:00Z').getTime());
        const latestEnd   = cycleEnds.length   ? Math.max(...cycleEnds)   : null;
        const earliestStart = cycleStarts.length ? Math.min(...cycleStarts) : null;

        if (earliestStart != null && rEndMs < earliestStart) {
          reason = 'report pre-dates all cycle starts (report too old)';
        } else if (latestEnd != null && rStartMs > latestEnd) {
          reason = 'report is newer than all cycle ends (no cycle yet covers it)';
        } else if (allSnapshots.some(s => !s.hasCycleStart)) {
          reason = 'overlapping cycle(s) lack cycleStart — allocation blocked';
        } else {
          reason = 'genuine gap — no cycle period covers this report';
        }
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
      console.log(
        `  ${`${wk} – ${weekSunday(wk)}`.padEnd(25)}  ${lpad(Math.round(units), 12)}  ${lpad(fmt$(revenue), 14)}`
      );
    }

    const totalUnits   = [...weekMap.values()].reduce((s, w) => s + w.units,   0);
    const totalRevenue = [...weekMap.values()].reduce((s, w) => s + w.revenue, 0);
    console.log(`  ${'-'.repeat(25)}  ${'-'.repeat(12)}  ${'-'.repeat(14)}`);
    console.log(
      `  ${'TOTAL'.padEnd(25)}  ${lpad(Math.round(totalUnits), 12)}  ${lpad(fmt$(totalRevenue), 14)}`
    );
  }

  // Top 10 by units
  console.log('\n  — Top 10 products by units (whole period) —\n');
  const sortedProds = [...productMap.entries()].sort((a, b) => b[1].totalUnits - a[1].totalUnits);
  const top10 = sortedProds.slice(0, 10);

  if (top10.length === 0) {
    console.log('  No matched products.');
  } else {
    console.log(`  ${'#'.padStart(2)}  ${'Product'.padEnd(38)}  ${'Units'.padStart(8)}  ${'Revenue'.padStart(12)}`);
    console.log(`  ${'--'}  ${'-------'.padEnd(38)}  ${'-----'.padStart(8)}  ${'-------'.padStart(12)}`);
    top10.forEach(([, v], idx) => {
      console.log(
        `  ${String(idx + 1).padStart(2)}  ${pad(v.name, 38)}  ${lpad(Math.round(v.totalUnits), 8)}  ${lpad(fmt$(v.totalRevenue), 12)}`
      );
    });
  }

  // Stagnant candidates: present in first-6 weeks, absent from last-4 weeks
  const first6Set  = new Set(sortedWeeks.slice(0, 6));
  const last4Set   = new Set(sortedWeeks.slice(-4));
  const last4Start = sortedWeeks.length >= 4 ? sortedWeeks[sortedWeeks.length - 4] : null;

  const stagnant = [];
  for (const [pid, p] of productMap.entries()) {
    const inFirst6 = [...p.reportWeeks].some(w => first6Set.has(w));
    const inLast4  = [...p.reportWeeks].some(w => last4Set.has(w));
    if (inFirst6 && !inLast4) stagnant.push([pid, p]);
  }
  stagnant.sort((a, b) => b[1].totalUnits - a[1].totalUnits);

  const first6end = weekSunday(sortedWeeks[5] ?? sortedWeeks[sortedWeeks.length - 1] ?? '?');
  console.log(`\n  — Stagnant candidates: sold in first 6 weeks (${sortedWeeks[0] ?? '?'}–${first6end})`);
  console.log(`    but absent from last 4 weeks (${last4Start ?? '?'} onwards) —\n`);
  console.log('  Note: absence means the product appeared in no report whose period');
  console.log('  overlaps the last-4-weeks window. Day-weighting distributes a report\'s');
  console.log('  sales uniformly — this does not prove week-by-week zero sales.\n');

  if (stagnant.length === 0) {
    console.log('  None detected.');
  } else {
    console.log(`  ${stagnant.length} candidate(s):\n`);
    console.log(`  ${'Product'.padEnd(38)}  ${'Hist.Units'.padStart(10)}  ${'Latest stock'.padStart(12)}`);
    console.log(`  ${'-------'.padEnd(38)}  ${'---------'.padStart(10)}  ${'------------'.padStart(12)}`);
    for (const [pid, p] of stagnant.slice(0, 25)) {
      const stock    = stockMap[pid];
      const stockStr = stock != null ? String(stock.count) : '—';
      console.log(
        `  ${pad(p.name, 38)}  ${lpad(Math.round(p.totalUnits), 10)}  ${lpad(stockStr, 12)}`
      );
    }
    if (stagnant.length > 25) console.log(`  … and ${stagnant.length - 25} more`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Budget preview
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n' + hr());
  console.log('4. BUDGET PREVIEW');
  console.log(hr());
  console.log('');
  console.log('  NOTE: Revenue is as exported (GST status unknown — figures may be');
  console.log('  inclusive or exclusive of GST depending on your POS export settings).\n');

  const todayNZ        = new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ });
  const currentWeekMon = weekMonday(todayNZ);
  const lastFullWeekMon = new Date(
    new Date(currentWeekMon + 'T00:00:00Z').getTime() - 7 * 86_400_000
  ).toISOString().slice(0, 10);

  const completeWeeks   = sortedWeeks.filter(w => w < currentWeekMon);
  const last4Budget     = completeWeeks.slice(-4);
  const lastWeekRev     = weekMap.get(lastFullWeekMon)?.revenue ?? null;
  const avg4 = last4Budget.length > 0
    ? last4Budget.reduce((s, w) => s + (weekMap.get(w)?.revenue ?? 0), 0) / last4Budget.length
    : null;

  const pcts = [25, 28, 30];

  if (lastWeekRev != null) {
    console.log(`  Last full week  ${lastFullWeekMon} – ${weekSunday(lastFullWeekMon)}: ${fmt$(lastWeekRev)}`);
    pcts.forEach(p => console.log(`    ${p}% = ${fmt$(lastWeekRev * p / 100)}`));
  } else {
    console.log(`  Last full week (${lastFullWeekMon}–${weekSunday(lastFullWeekMon)}): no matched sales data.`);
  }

  console.log('');

  if (avg4 != null) {
    console.log(`  Average of last ${last4Budget.length} complete week(s): ${fmt$(avg4)}`);
    console.log(`    (${last4Budget.join(', ')})`);
    pcts.forEach(p => console.log(`    ${p}% = ${fmt$(avg4 * p / 100)}`));
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

  const totalReportedRevenue = reports.reduce((s, r) => s + r.totalRevenue, 0);
  const totalMatchedRevenue  = Object.values(matchesByReport).reduce((s, m) => s + (m?.matchedRevenue ?? 0), 0);
  const totalReportedLines   = reports.reduce((s, r) => s + r.lineCount, 0);
  const totalMatchedLines    = Object.values(matchesByReport).reduce((s, m) => s + (m?.matched ?? 0), 0);
  const noMatchCount         = Object.values(matchesByReport).filter(m => m === null).length;

  const dateRange = reports.length > 0
    ? `${reports[0].startStr} → ${reports[reports.length - 1].endStr}`
    : '—';

  console.log(`  Active reports          : ${reports.length}  (+${prePeriod.length} pre-period, +${supersededCount} superseded)`);
  console.log(`  Date range              : ${dateRange}`);
  console.log(`  Calendar weeks covered  : ${sortedWeeks.length}${gapWeeks.length > 0 ? `  (⚠ ${gapWeeks.length} gap week(s))` : ''}`);
  console.log(`  Snapshots found         : ${allSnapshots.length}  (${deptsSnap.size} dept(s))`);
  console.log(`  Reported revenue        : ${fmt$(totalReportedRevenue)}`);
  console.log(`  Matched revenue         : ${fmt$(totalMatchedRevenue)}  (${pct(totalMatchedRevenue, totalReportedRevenue)})`);
  console.log(`  Reported lines          : ${totalReportedLines}`);
  console.log(`  Matched lines           : ${totalMatchedLines}  (${pct(totalMatchedLines, totalReportedLines)})`);
  console.log(`  Reports without matches : ${noMatchCount}`);
  console.log(`  Distinct matched products: ${productMap.size}`);
  console.log(`  Stagnant candidates     : ${stagnant.length}`);
  console.log('');

  // Score and rank issues
  const issues = [];

  const lineMatchFrac = totalReportedLines > 0 ? totalMatchedLines / totalReportedLines : 1;
  const revMatchFrac  = totalReportedRevenue > 0 ? totalMatchedRevenue / totalReportedRevenue : 1;

  if (lineMatchFrac < 0.70) {
    issues.push({ sev: 0, label: 'CRITICAL',
      title: `Low product-match rate: ${pct(totalMatchedLines, totalReportedLines)} of lines matched`,
      detail: `${totalReportedLines - totalMatchedLines} lines are unmatched. These are excluded from the `
        + `weekly ledger and budget figures — velocity and revenue are understated. `
        + `Priority: run the sales matcher and resolve unknowns in salesReportUnknowns.` });
  } else if (lineMatchFrac < 0.85) {
    issues.push({ sev: 1, label: 'HIGH',
      title: `Moderate match rate: ${pct(totalMatchedLines, totalReportedLines)} of lines matched`,
      detail: `${totalReportedLines - totalMatchedLines} unmatched lines excluded. `
        + `Resolve unknowns in salesReportUnknowns to improve ledger accuracy.` });
  }

  if (revMatchFrac < 0.80) {
    issues.push({ sev: 1, label: 'HIGH',
      title: `Revenue match gap: only ${pct(totalMatchedRevenue, totalReportedRevenue)} of reported revenue is matched`,
      detail: `${fmt$(totalReportedRevenue - totalMatchedRevenue)} of revenue is on unmatched lines. `
        + `Budget projections (Section 4) are based on matched revenue only and will be understated.` });
  }

  if (gapWeeks.length >= 4) {
    issues.push({ sev: 0, label: 'CRITICAL',
      title: `${gapWeeks.length} calendar week(s) with no sales data`,
      detail: `Gap weeks: ${gapWeeks.slice(0, 3).join(', ')}${gapWeeks.length > 3 ? '…' : ''}. `
        + `4-week averages and trend lines are distorted. Upload missing reports to fill the gaps.` });
  } else if (gapWeeks.length > 0) {
    issues.push({ sev: 2, label: 'MEDIUM',
      title: `${gapWeeks.length} gap week(s) between the first and last report`,
      detail: `Missing: ${gapWeeks.join(', ')}. 4-week averages skip these weeks.` });
  }

  if (noMatchCount > 0) {
    issues.push({ sev: 1, label: 'HIGH',
      title: `${noMatchCount} report(s) have no salesReportMatches document`,
      detail: `These reports' lines are completely absent from the ledger. `
        + `Re-trigger the sales matcher for the affected report IDs.` });
  }

  const noStartSnaps = allSnapshots.filter(s => !s.hasCycleStart);
  if (noStartSnaps.length > 0) {
    issues.push({ sev: 2, label: 'MEDIUM',
      title: `${noStartSnaps.length} snapshot(s) have no cycleStart`,
      detail: `cycleStart is required for day-weighted allocation. Affected: `
        + noStartSnaps.map(s => `cycle-${s.cycleNumber} (${s.departmentName})`).join(', ')
        + `. These cycles default to allocationMethod=none.` });
  }

  const unlinked = reports.filter(r => r.overlappingCycles.length === 0);
  if (unlinked.length > 0) {
    issues.push({ sev: 2, label: 'MEDIUM',
      title: `${unlinked.length} report(s) not linked to any stocktake cycle`,
      detail: `Without a cycle link sales cannot be attributed to a variance period. `
        + `Either the reports pre-date the first stocktake or a cycle is missing cycleStart.` });
  }

  if (supersededCount > 5) {
    issues.push({ sev: 3, label: 'LOW',
      title: `${supersededCount} superseded reports (high re-upload count)`,
      detail: `Many superseded reports may indicate repeated corrections. `
        + `Verify that the active set represents the intended final state.` });
  }

  issues.sort((a, b) => a.sev - b.sev);

  console.log('  Three biggest data-quality problems:\n');
  if (issues.length === 0) {
    console.log('  No significant issues detected from aggregate data.');
  } else {
    issues.slice(0, 3).forEach((iss, i) => {
      console.log(`  #${i + 1} [${iss.label}]  ${iss.title}`);
      const words = iss.detail.split(' ');
      let line = '         ';
      words.forEach(w => {
        if (line.length + w.length > 72) { console.log(line); line = '         '; }
        line += w + ' ';
      });
      if (line.trim()) console.log(line);
      console.log('');
    });
  }

  console.log('═'.repeat(64));
  console.log('  END OF PREVIEW  –  no writes were made.');
  console.log('═'.repeat(64) + '\n');
}

main().catch(e => {
  console.error('\nScript error:', e?.message ?? e);
  process.exit(1);
});

// ── Self-test (node preview-weekly-ledger.js --test) ──────────────────────
// Exercises the pure in-memory helpers without any Firebase connection.

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) console.log(`        got: ${JSON.stringify(got)}\n   expected: ${JSON.stringify(expected)}`);
    ok ? pass++ : fail++;
  }

  console.log('\nSelf-test: pure helpers\n');

  // weekMonday
  assert('weekMonday: Monday input unchanged',        weekMonday('2024-10-07'), '2024-10-07');
  assert('weekMonday: Sunday → prior Monday',         weekMonday('2024-10-13'), '2024-10-07');
  assert('weekMonday: Wednesday mid-week',            weekMonday('2024-10-09'), '2024-10-07');
  assert('weekMonday: Saturday → prior Monday',       weekMonday('2024-10-12'), '2024-10-07');
  assert('weekMonday: week boundary Jan 1 (Monday)',  weekMonday('2024-01-01'), '2024-01-01');
  assert('weekMonday: Jan 2 (Tuesday)',               weekMonday('2024-01-02'), '2024-01-01');

  // weekSunday
  assert('weekSunday: Mon → Sun same week', weekSunday('2024-10-07'), '2024-10-13');
  assert('weekSunday: cross-month boundary', weekSunday('2024-09-30'), '2024-10-06');

  // daySpan
  assert('daySpan: same day = 1',            daySpan('2024-01-01', '2024-01-01'), 1);
  assert('daySpan: two consecutive days = 2', daySpan('2024-01-01', '2024-01-02'), 2);
  assert('daySpan: one week = 7',            daySpan('2024-01-01', '2024-01-07'), 7);

  // weekDayBreakdown: single week
  assert('wdBreakdown: 7-day single week → 7 days',
    weekDayBreakdown('2024-10-07', '2024-10-13'),
    { '2024-10-07': 7 }
  );

  // weekDayBreakdown: spans two weeks (Wed–Tue)
  const wdTwo = weekDayBreakdown('2024-10-09', '2024-10-15');
  assert('wdBreakdown: Wed–Tue spans two weeks — first week (Mon 07) gets 5 days',
    wdTwo['2024-10-07'], 5);
  assert('wdBreakdown: Wed–Tue spans two weeks — second week (Mon 14) gets 2 days',
    wdTwo['2024-10-14'], 2);
  assert('wdBreakdown: sum of days equals period length',
    Object.values(wdTwo).reduce((s, v) => s + v, 0), daySpan('2024-10-09', '2024-10-15'));

  // partitionReports — stub Firestore-like snapshots
  function fakeDoc(id, data) {
    return { id, data: () => data };
  }

  const fakeDocs = [
    fakeDoc('r1', { status: 'active',     periodStart: { toMillis: () => new Date('2024-01-01').getTime() }, report: { period: { start: '2024-01-01', end: '2024-01-07' }, lines: [] } }),
    fakeDoc('r2', { status: 'superseded', periodStart: { toMillis: () => new Date('2024-01-08').getTime() }, report: { period: { start: '2024-01-08', end: '2024-01-14' }, lines: [] } }),
    fakeDoc('r3', { status: 'active',     periodStart: { toMillis: () => new Date('2024-02-01').getTime() }, report: { period: { start: '2024-02-01', end: '2024-02-07' }, lines: [] } }),
    fakeDoc('r4', {                        /* no status */                                                    report: { period: { start: '2024-01-15', end: '2024-01-21' }, lines: [] } }),
    fakeDoc('r5', { status: 'active',     /* no periodStart */                                               report: { period: { start: null, end: null }, lines: [] } }),
  ];

  const partitioned = partitionReports(fakeDocs);

  assert('partition: supersededCount = 1',  partitioned.supersededCount, 1);
  assert('partition: noStatusCount = 1',    partitioned.noStatusCount,   1);
  assert('partition: prePeriod length = 1', partitioned.prePeriod.length, 1);
  assert('partition: prePeriod is r5',      partitioned.prePeriod[0].id, 'r5');
  // dated active: r1 (Jan 1), r4 (Jan 15, no status), r3 (Feb 1) — sorted ascending
  assert('partition: dated reports count = 3', partitioned.reports.length, 3);
  assert('partition: sorted[0] = r1',          partitioned.reports[0].id, 'r1');
  assert('partition: sorted[1] = r4 (no status, Jan 15)', partitioned.reports[1].id, 'r4');
  assert('partition: sorted[2] = r3 (Feb 1)', partitioned.reports[2].id, 'r3');

  // Gap detection from allWeeks
  // Two reports: Jan 1-7 and Jan 22-28 → gap is Jan 8–21 = weeks starting Jan 8 and Jan 15
  function buildAllWeeks(reportList) {
    const s = new Set();
    for (const r of reportList) {
      if (!r.startStr || !r.endStr) continue;
      let cur = new Date(r.startStr + 'T00:00:00Z');
      const end = new Date(r.endStr + 'T00:00:00Z');
      while (cur <= end) {
        s.add(weekMonday(cur.toISOString().slice(0, 10)));
        cur = new Date(cur.getTime() + 7 * 86_400_000);
      }
    }
    return s;
  }
  const gapTestReports = [
    { startStr: '2024-01-01', endStr: '2024-01-07' },
    { startStr: '2024-01-22', endStr: '2024-01-28' },
  ];
  const aw = buildAllWeeks(gapTestReports);
  assert('gap: week Jan 1 is present',  aw.has('2024-01-01'), true);
  assert('gap: week Jan 8 is absent',   aw.has('2024-01-08'), false);
  assert('gap: week Jan 15 is absent',  aw.has('2024-01-15'), false);
  assert('gap: week Jan 22 is present', aw.has('2024-01-22'), true);

  // Stagnant detection
  const stagnantWeeks = ['2024-01-01','2024-01-08','2024-01-15','2024-01-22',
                         '2024-01-29','2024-02-05',  // first 6
                         '2024-02-12','2024-02-19','2024-02-26','2024-03-04']; // last 4
  const f6 = new Set(stagnantWeeks.slice(0, 6));
  const l4 = new Set(stagnantWeeks.slice(-4));
  const pA = { name:'A', totalUnits:10, reportWeeks: new Set(['2024-01-01','2024-01-08']) }; // first6 only → stagnant
  const pB = { name:'B', totalUnits:5,  reportWeeks: new Set(['2024-01-01','2024-03-04']) }; // first6 + last4 → not stagnant
  const pC = { name:'C', totalUnits:2,  reportWeeks: new Set(['2024-02-26']) };               // last4 only → not stagnant
  function detectStagnant(pm, first6, last4) {
    return [...pm.entries()].filter(([, p]) => {
      return [...p.reportWeeks].some(w => first6.has(w)) && ![...p.reportWeeks].some(w => last4.has(w));
    }).map(([id]) => id);
  }
  const pm = new Map([['pA', pA], ['pB', pB], ['pC', pC]]);
  const stagnantIds = detectStagnant(pm, f6, l4);
  assert('stagnant: only pA is stagnant', stagnantIds, ['pA']);

  console.log(`\n  ${pass} passed, ${fail} failed.\n`);
  if (fail > 0) process.exit(1);
}
