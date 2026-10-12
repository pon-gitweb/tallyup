/**
 * preview-weekly-ledger.js  –  READ-ONLY weekly ledger preview.
 *
 * Usage:
 *   node scripts/admin/preview-weekly-ledger.js [--venue VENUE_ID]
 *
 * Authorised venue: O9pChydjz75nwpWA81KO
 * The script refuses to run against any other venue.
 *
 * Safety:
 *   - No writes, no deletes, no Firebase Auth calls.
 *   - Product names are printed only in the top-10 and stagnant lists.
 *   - All other output is aggregate / numeric only.
 *   - Timestamps are rendered in Pacific/Auckland local time.
 */

'use strict';

const admin = require('firebase-admin');

// ── Constants ──────────────────────────────────────────────────────────────

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
  return d.toLocaleDateString('en-CA', { timeZone: NZ_TZ }); // en-CA gives YYYY-MM-DD
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  WEEKLY LEDGER PREVIEW  –  venue ${VENUE_ID}`);
  console.log(`  Read-only. Dates in Pacific/Auckland.`);
  console.log(`  Generated: ${new Date().toLocaleString('en-NZ', { timeZone: NZ_TZ })}`);
  console.log(`${'═'.repeat(64)}\n`);

  // ── 0: Fetch all salesReports (active + superseded) ─────────────────────

  const [activeSnap, supersededSnap] = await Promise.all([
    db.collection(`venues/${VENUE_ID}/salesReports`)
      .where('status', '==', 'active')
      .orderBy('periodStart', 'asc')
      .get(),
    db.collection(`venues/${VENUE_ID}/salesReports`)
      .where('status', '==', 'superseded')
      .get(),
  ]);

  const supersededCount = supersededSnap.size;

  /** @type {Array<{id,source,startStr,endStr,days,lineCount,totalRevenue,overlappingCycles,allocationMethod}>} */
  const reports = activeSnap.docs.map(docSnap => {
    const d = docSnap.data();
    const lines = d.report?.lines ?? d.lines ?? [];
    const totalRevenue = lines.reduce((s, l) => s + (l.gross ?? 0), 0);
    const startStr = d.report?.period?.start ?? toNZDate(d.periodStart);
    const endStr = d.report?.period?.end ?? toNZDate(d.periodEnd);
    return {
      id: docSnap.id,
      source: d.source ?? '?',
      startStr,
      endStr,
      days: startStr && endStr ? daySpan(startStr, endStr) : null,
      lineCount: lines.length,
      totalRevenue,
      overlappingCycles: d.overlappingCycles ?? [],
      allocationMethod: d.allocationMethod ?? 'none',
    };
  });

  // ── 0b: Fetch salesReportMatches for each active report ─────────────────
  // Shape B (Cloud Functions): doc ID = reportId
  // Shape A (client): query by reportId field (fallback)

  const matchesByReport = {}; // reportId → { matched, total, matchedRevenue, matches[] } | null

  await Promise.all(reports.map(async r => {
    // Try Shape B first (deterministic ID)
    let matchDoc = await db.doc(`venues/${VENUE_ID}/salesReportMatches/${r.id}`).get();

    // Fallback: query by reportId field (Shape A, auto-ID)
    if (!matchDoc.exists) {
      const q = await db.collection(`venues/${VENUE_ID}/salesReportMatches`)
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
    const matchedQty = matches.reduce((s, m) => s + (m.qtySold ?? 0), 0);
    matchesByReport[r.id] = {
      matched: md.counts?.matched ?? matches.length,
      total: md.counts?.total ?? r.lineCount,
      matchedRevenue,
      matchedQty,
      matches,
    };
  }));

  // ── 0c: Fetch department snapshots ──────────────────────────────────────

  const deptsSnap = await db.collection(`venues/${VENUE_ID}/departments`).get();
  /** @type {Array<{departmentId,departmentName,cycleNumber,cycleStart,cycleEnd,hasCycleStart,items}>} */
  const allSnapshots = [];

  await Promise.all(deptsSnap.docs.map(async deptDoc => {
    const snapsSnap = await db
      .collection(`venues/${VENUE_ID}/departments/${deptDoc.id}/snapshots`)
      .orderBy('cycleNumber', 'asc')
      .get();
    for (const sDoc of snapsSnap.docs) {
      const s = sDoc.data();
      allSnapshots.push({
        departmentId: deptDoc.id,
        departmentName: s.departmentName ?? deptDoc.data().name ?? deptDoc.id,
        cycleNumber: s.cycleNumber,
        cycleStart: toNZDate(s.cycleStart),
        cycleEnd: toNZDate(s.cycleEnd),
        hasCycleStart: !!s.cycleStart,
        items: s.items ?? [],
      });
    }
  }));

  allSnapshots.sort((a, b) =>
    a.departmentId.localeCompare(b.departmentId) || a.cycleNumber - b.cycleNumber
  );

  // ── 0d: Build weekly aggregation (all matched lines, day-weighted) ───────

  // weekMap:       Monday → { units: number, revenue: number }
  // productMap:    productId → { name, totalUnits, totalRevenue, reportWeeks: Set<mondayStr> }
  const weekMap = new Map();
  const productMap = new Map();

  for (const r of reports) {
    const md = matchesByReport[r.id];
    if (!md || !r.startStr || !r.endStr) continue;

    const totalDays = r.days;
    const wdMap = weekDayBreakdown(r.startStr, r.endStr); // mondayStr → daysInWeek

    for (const m of md.matches) {
      const pid = m.productId;
      if (!pid) continue;
      const name = m.productName ?? m.name ?? pid;
      const qty = m.qtySold ?? 0;
      const gross = m.gross ?? 0;

      for (const [wk, daysInWk] of Object.entries(wdMap)) {
        const frac = daysInWk / totalDays;
        const wkQty = qty * frac;
        const wkRev = gross * frac;

        if (!weekMap.has(wk)) weekMap.set(wk, { units: 0, revenue: 0 });
        const wkEntry = weekMap.get(wk);
        wkEntry.units += wkQty;
        wkEntry.revenue += wkRev;

        if (!productMap.has(pid)) {
          productMap.set(pid, { name, totalUnits: 0, totalRevenue: 0, reportWeeks: new Set() });
        }
        const pEntry = productMap.get(pid);
        pEntry.totalUnits += wkQty;
        pEntry.totalRevenue += wkRev;
        pEntry.reportWeeks.add(wk);
      }
    }
  }

  const sortedWeeks = [...weekMap.keys()].sort();

  // ── 0e: Build allWeeks set (for gap detection) ───────────────────────────

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

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Sales reports list
  // ═══════════════════════════════════════════════════════════════════════

  console.log(hr());
  console.log('1. ACTIVE SALES REPORTS');
  console.log(hr());
  console.log('');

  if (supersededCount > 0) {
    console.log(`  ⚠  ${supersededCount} superseded report(s) also exist (excluded from analysis).`);
    console.log('');
  }

  if (reports.length === 0) {
    console.log('  No active reports found.');
  }

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const md = matchesByReport[r.id];
    const matchedLines = md?.matched ?? 0;
    const matchedRev = md?.matchedRevenue ?? 0;
    const matchPctLines = pct(matchedLines, md?.total ?? r.lineCount);
    const matchPctRev = pct(matchedRev, r.totalRevenue);

    console.log(`  [${ i + 1 }] ${r.id}`);
    console.log(`      Period : ${r.startStr ?? '?'} → ${r.endStr ?? '?'}  (${r.days ?? '?'} days)`);
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

  // Gap analysis
  console.log('  — Gap / overlap analysis —\n');

  const gapWeeks = [];
  if (reports.length > 0) {
    const firstStart = reports.find(r => r.startStr)?.startStr;
    const lastEnd = [...reports].reverse().find(r => r.endStr)?.endStr;
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

  // Overlap detection
  let overlapFound = false;
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const a = reports[i], b = reports[j];
      if (a.startStr && a.endStr && b.startStr && b.endStr &&
          a.startStr <= b.endStr && b.startStr <= a.endStr) {
        console.log(`  ✗ OVERLAP  report [${i+1}] (${a.startStr}–${a.endStr}) overlaps [${j+1}] (${b.startStr}–${b.endStr})`);
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
    // Group by department for display
    const byDept = {};
    for (const s of allSnapshots) {
      (byDept[s.departmentId] = byDept[s.departmentId] || []).push(s);
    }
    for (const [deptId, snaps] of Object.entries(byDept)) {
      console.log(`  Dept: ${snaps[0].departmentName}  (${deptId})`);
      for (const s of snaps) {
        const startFlag = s.hasCycleStart ? '' : '  ⚠ cycleStart MISSING';
        const startStr = s.cycleStart ?? '(none)';
        console.log(`    cycle-${s.cycleNumber}:  ${startStr} → ${s.cycleEnd ?? '?'}${startFlag}`);
      }
    }
  }

  console.log('\n  — Report → cycle linkage —\n');

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const label = `  [${i+1}] ${r.startStr ?? '?'}–${r.endStr ?? '?'}`;

    if (r.overlappingCycles.length > 0) {
      const methodNote = r.allocationMethod === 'exact_single_cycle'
        ? 'exact single cycle'
        : r.allocationMethod === 'day_weighted_estimate'
          ? 'day-weighted across cycles'
          : r.allocationMethod;
      console.log(`${label}  →  ${r.overlappingCycles.length} cycle(s)  [${methodNote}]`);
      r.overlappingCycles.forEach(c =>
        console.log(`       cycle-${c.cycleNumber}  dept=${c.departmentId}  weight=${c.weight?.toFixed(3) ?? '?'}`)
      );
    } else {
      // Diagnose why no link
      let reason;
      if (!r.startStr || !r.endStr) {
        reason = 'report has no period dates — cannot link';
      } else if (allSnapshots.length === 0) {
        reason = 'no stocktake snapshots exist for this venue';
      } else {
        const reportEndMS = new Date(r.endStr + 'T00:00:00Z').getTime();
        const reportStartMS = new Date(r.startStr + 'T00:00:00Z').getTime();
        const latestCycleEndMS = Math.max(
          ...allSnapshots.filter(s => s.cycleEnd).map(s => new Date(s.cycleEnd + 'T00:00:00Z').getTime())
        );
        const earliestCycleStartMS = Math.min(
          ...allSnapshots.filter(s => s.cycleStart).map(s => new Date(s.cycleStart + 'T00:00:00Z').getTime())
        );
        const hasNoStart = allSnapshots.some(s => !s.hasCycleStart);

        if (reportEndMS < earliestCycleStartMS) {
          reason = 'report pre-dates all cycle starts (report too old)';
        } else if (reportStartMS > latestCycleEndMS) {
          reason = 'report is newer than all cycle ends (no cycle yet covers it)';
        } else if (hasNoStart) {
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
      const sun = weekSunday(wk);
      console.log(
        `  ${`${wk} – ${sun}`.padEnd(25)}  ${lpad(Math.round(units), 12)}  ${lpad(fmt$(revenue), 14)}`
      );
    }

    // Totals row
    const totalUnits = [...weekMap.values()].reduce((s, w) => s + w.units, 0);
    const totalRevenue = [...weekMap.values()].reduce((s, w) => s + w.revenue, 0);
    console.log(`  ${'-'.repeat(25)}  ${'-'.repeat(12)}  ${'-'.repeat(14)}`);
    console.log(
      `  ${'TOTAL'.padEnd(25)}  ${lpad(Math.round(totalUnits), 12)}  ${lpad(fmt$(totalRevenue), 14)}`
    );
  }

  // Top 10 by units
  console.log('\n  — Top 10 products by units (whole period) —\n');
  const sorted = [...productMap.entries()]
    .sort((a, b) => b[1].totalUnits - a[1].totalUnits);
  const top10 = sorted.slice(0, 10);

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

  // Bottom / stagnant candidates
  //   Sold in weeks 1–6 but not in last 4 weeks
  const first6Set = new Set(sortedWeeks.slice(0, 6));
  const last4Set = new Set(sortedWeeks.slice(-4));
  const last4StartStr = sortedWeeks.length >= 4 ? sortedWeeks[sortedWeeks.length - 4] : null;

  const stagnant = [];
  for (const [pid, p] of productMap.entries()) {
    const inFirst6 = [...p.reportWeeks].some(w => first6Set.has(w));
    const inLast4 = [...p.reportWeeks].some(w => last4Set.has(w));
    if (inFirst6 && !inLast4) stagnant.push([pid, p]);
  }
  stagnant.sort((a, b) => b[1].totalUnits - a[1].totalUnits);

  console.log(`\n  — Stagnant candidates: sold in first 6 weeks (${sortedWeeks[0] ?? '?'}–${weekSunday(sortedWeeks[5] ?? sortedWeeks[0] ?? '?')})`);
  console.log(`    but absent from last 4 weeks (${last4StartStr ?? '?'} onwards) —\n`);
  console.log(`  Note: "absence" is based on whether the product appeared in any report`);
  console.log(`  whose period overlaps the last-4-weeks window. Day-weighted distribution`);
  console.log(`  is applied — this does not prove week-by-week zero sales.\n`);

  if (stagnant.length === 0) {
    console.log('  None detected.');
  } else {
    console.log(`  ${stagnant.length} candidate(s):\n`);
    console.log(`  ${'Product'.padEnd(38)}  ${'Hist.Units'.padStart(10)}  ${'Latest stock'.padStart(12)}`);
    console.log(`  ${'-------'.padEnd(38)}  ${'---------'.padStart(10)}  ${'------------'.padStart(12)}`);
    for (const [pid, p] of stagnant.slice(0, 25)) {
      const stock = stockMap[pid];
      const stockStr = stock != null ? String(stock.count) : '—';
      console.log(
        `  ${pad(p.name, 38)}  ${lpad(Math.round(p.totalUnits), 10)}  ${lpad(stockStr, 12)}`
      );
    }
    if (stagnant.length > 25) {
      console.log(`  … and ${stagnant.length - 25} more`);
    }
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

  // "Last full week" = last complete Mon–Sun week strictly before the current calendar week
  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ });
  const currentWeekMon = weekMonday(todayNZ);
  const lastFullWeekMon = new Date(new Date(currentWeekMon + 'T00:00:00Z').getTime() - 7 * 86_400_000)
    .toISOString().slice(0, 10);

  const weeksForBudget = sortedWeeks.filter(w => w < currentWeekMon);
  const last4Budget = weeksForBudget.slice(-4);
  const lastFullData = weekMap.get(lastFullWeekMon);
  const lastWeekRev = lastFullData?.revenue ?? null;
  const avg4 = last4Budget.length > 0
    ? last4Budget.reduce((s, w) => s + (weekMap.get(w)?.revenue ?? 0), 0) / last4Budget.length
    : null;

  const pcts = [25, 28, 30];

  if (lastWeekRev != null) {
    console.log(`  Last full week  ${lastFullWeekMon} – ${weekSunday(lastFullWeekMon)}: ${fmt$(lastWeekRev)}`);
    pcts.forEach(p => console.log(`    ${p}% = ${fmt$(lastWeekRev * p / 100)}`));
  } else {
    console.log(`  Last full week (${lastFullWeekMon}): no matched sales data for that week.`);
  }

  console.log('');

  if (avg4 != null) {
    console.log(`  Average of last ${last4Budget.length} complete week(s): ${fmt$(avg4)}`);
    console.log(`    (weeks: ${last4Budget.join(', ')})`);
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
  const totalMatchedRevenue = Object.values(matchesByReport)
    .reduce((s, m) => s + (m?.matchedRevenue ?? 0), 0);
  const totalReportedLines = reports.reduce((s, r) => s + r.lineCount, 0);
  const totalMatchedLines = Object.values(matchesByReport)
    .reduce((s, m) => s + (m?.matched ?? 0), 0);
  const noMatchReports = Object.values(matchesByReport).filter(m => m === null).length;

  console.log(`  Active reports          : ${reports.length}  (+${supersededCount} superseded)`);
  const dateRange = reports.length > 0
    ? `${reports.find(r => r.startStr)?.startStr ?? '?'} → ${[...reports].reverse().find(r => r.endStr)?.endStr ?? '?'}`
    : '—';
  console.log(`  Date range              : ${dateRange}`);
  console.log(`  Calendar weeks covered  : ${sortedWeeks.length}${gapWeeks.length > 0 ? `  (⚠ ${gapWeeks.length} gap weeks)` : ''}`);
  console.log(`  Snapshots found         : ${allSnapshots.length}  (${deptsSnap.size} depts)`);
  console.log(`  Reported revenue        : ${fmt$(totalReportedRevenue)}`);
  console.log(`  Matched revenue         : ${fmt$(totalMatchedRevenue)}  (${pct(totalMatchedRevenue, totalReportedRevenue)})`);
  console.log(`  Reported lines          : ${totalReportedLines}`);
  console.log(`  Matched lines           : ${totalMatchedLines}  (${pct(totalMatchedLines, totalReportedLines)})`);
  console.log(`  Reports without matches : ${noMatchReports}`);
  console.log(`  Distinct products       : ${productMap.size}`);
  console.log(`  Stagnant candidates     : ${stagnant.length}`);
  console.log('');

  // Build issue list, scored, take top 3
  const issues = [];

  // --- match rate issues
  const lineMatchPct = totalReportedLines > 0
    ? totalMatchedLines / totalReportedLines : 1;
  const revMatchPct = totalReportedRevenue > 0
    ? totalMatchedRevenue / totalReportedRevenue : 1;

  if (lineMatchPct < 0.70) {
    issues.push({
      sev: 0, label: 'CRITICAL',
      title: `Low product-match rate: ${pct(totalMatchedLines, totalReportedLines)} of lines matched`,
      detail: `${totalReportedLines - totalMatchedLines} lines are unmatched (unknown products). `
        + `These are excluded from the weekly ledger and budget figures, so velocity and revenue `
        + `are understated. Priority: run the sales matcher and resolve unknowns.`,
    });
  } else if (lineMatchPct < 0.85) {
    issues.push({
      sev: 1, label: 'HIGH',
      title: `Moderate match rate: ${pct(totalMatchedLines, totalReportedLines)} of lines matched`,
      detail: `${totalReportedLines - totalMatchedLines} unmatched lines excluded from the ledger. `
        + `Resolve unknowns in salesReportUnknowns to improve ledger accuracy.`,
    });
  }

  if (revMatchPct < 0.80 && totalMatchedRevenue !== totalReportedRevenue) {
    issues.push({
      sev: 1, label: 'HIGH',
      title: `Revenue match gap: only ${pct(totalMatchedRevenue, totalReportedRevenue)} of reported revenue is matched`,
      detail: `${fmt$(totalReportedRevenue - totalMatchedRevenue)} of revenue is on unmatched lines. `
        + `Budget projections (Section 4) are based on matched revenue only and are understated.`,
    });
  }

  // --- gap issues
  if (gapWeeks.length >= 4) {
    issues.push({
      sev: 0, label: 'CRITICAL',
      title: `${gapWeeks.length} consecutive calendar week(s) with no sales data`,
      detail: `Gap weeks: ${gapWeeks.slice(0, 3).join(', ')}${gapWeeks.length > 3 ? '…' : ''}. `
        + `The weekly trend and 4-week averages will be distorted. Upload missing reports to fill the gaps.`,
    });
  } else if (gapWeeks.length > 0) {
    issues.push({
      sev: 2, label: 'MEDIUM',
      title: `${gapWeeks.length} gap week(s) with no sales data`,
      detail: `Missing: ${gapWeeks.join(', ')}. 4-week averages and trend lines skip these weeks.`,
    });
  }

  // --- no-match docs
  if (noMatchReports > 0) {
    issues.push({
      sev: 1, label: 'HIGH',
      title: `${noMatchReports} report(s) have no salesReportMatches document`,
      detail: `These reports' lines are completely absent from the weekly ledger. `
        + `Re-trigger the sales matcher for the affected reports.`,
    });
  }

  // --- snapshots missing cycleStart
  const noStartSnaps = allSnapshots.filter(s => !s.hasCycleStart);
  if (noStartSnaps.length > 0) {
    issues.push({
      sev: 2, label: 'MEDIUM',
      title: `${noStartSnaps.length} snapshot(s) have no cycleStart`,
      detail: `cycleStart is required for day-weighted allocation. Snapshots: `
        + noStartSnaps.map(s => `cycle-${s.cycleNumber} (${s.departmentName})`).join(', ')
        + `. These cycles default to allocationMethod=none.`,
    });
  }

  // --- reports not linked to any cycle
  const unlinkedReports = reports.filter(r => r.overlappingCycles.length === 0);
  if (unlinkedReports.length > 0) {
    issues.push({
      sev: 2, label: 'MEDIUM',
      title: `${unlinkedReports.length} report(s) not linked to any stocktake cycle`,
      detail: `Without a cycle link, sales cannot be attributed to a variance period. `
        + `Either the reports pre-date the first stocktake or a cycle is missing cycleStart.`,
    });
  }

  // --- superseded count high
  if (supersededCount > 5) {
    issues.push({
      sev: 3, label: 'LOW',
      title: `${supersededCount} superseded reports suggest a high re-upload rate`,
      detail: `Many superseded reports can indicate repeated corrections. `
        + `Verify the active set is the intended final version.`,
    });
  }

  issues.sort((a, b) => a.sev - b.sev);
  const top3 = issues.slice(0, 3);

  console.log('  Three biggest data-quality problems:\n');
  if (top3.length === 0) {
    console.log('  No significant issues detected from aggregate data.');
  } else {
    top3.forEach((iss, i) => {
      console.log(`  #${i + 1} [${iss.label}]  ${iss.title}`);
      // Word-wrap the detail at ~70 chars
      const words = iss.detail.split(' ');
      let line = '         ';
      words.forEach(w => {
        if (line.length + w.length > 72) {
          console.log(line);
          line = '         ' + w + ' ';
        } else {
          line += w + ' ';
        }
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
