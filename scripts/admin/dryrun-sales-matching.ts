/**
 * READ-ONLY dry-run: compare stored vs new sales-line matching results.
 *
 * Loads the stored salesReportMatches + salesReportUnknowns for one report,
 * runs every line through the new matchSalesLine logic, and prints a diff table.
 *
 * Usage:
 *   npx tsx scripts/admin/dryrun-sales-matching.ts
 *   npx tsx scripts/admin/dryrun-sales-matching.ts <venueId> <reportId>
 *
 * No writes. No revenue figures printed.
 * Requires Application Default Credentials (gcloud auth application-default login).
 */

import { Firestore } from '@google-cloud/firestore';
import { matchSalesLine, buildProductIndex, isBlankSalesLine } from '../../functions/src/salesMatching';

const DEFAULT_VENUE_ID  = 'O9pChydjz75nwpWA81KO';
const DEFAULT_REPORT_ID = 'zdgLVtTvTxC51zMKeZCF';

async function main() {
  const venueId  = process.argv[2] || DEFAULT_VENUE_ID;
  const reportId = process.argv[3] || DEFAULT_REPORT_ID;

  console.log(`\nDry-run: venue=${venueId}  report=${reportId}\n`);

  const db = new Firestore();

  // ── Load stored OLD results ────────────────────────────────────────────────
  const matchDocSnap = await db
    .doc(`venues/${venueId}/salesReportMatches/${reportId}`)
    .get();

  if (!matchDocSnap.exists) {
    console.error(`salesReportMatches/${reportId} not found — check venueId/reportId.`);
    process.exit(1);
  }

  const matchData = matchDocSnap.data() as any;
  const storedMatches: any[] = matchData.matches ?? [];

  // Unknowns are stored per-name (deduplicated across runs); fetch by reportId
  const unknownsSnap = await db
    .collection(`venues/${venueId}/salesReportUnknowns`)
    .where('reportId', '==', reportId)
    .get();
  const storedUnknowns: any[] = unknownsSnap.docs.map(d => d.data());

  // Build OLD result map: lowercased name → { productName, via } | 'UNKNOWN'
  type OldResult = { productName: string; via: string } | 'UNKNOWN';
  const oldResultByName = new Map<string, OldResult>();
  for (const m of storedMatches) {
    if (m.name != null) {
      oldResultByName.set(m.name.toLowerCase(), { productName: m.productName, via: m.via });
    }
  }
  for (const u of storedUnknowns) {
    const name = u.line?.name;
    if (name != null) {
      oldResultByName.set(name.toLowerCase(), 'UNKNOWN');
    }
  }

  // ── Load products & mappings ───────────────────────────────────────────────
  const productsSnap = await db.collection(`venues/${venueId}/products`).get();
  const allProducts: any[] = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const productIndex = buildProductIndex(allProducts);

  const mappingsSnap = await db.collection(`venues/${venueId}/posProductMappings`).get();
  const confirmedMappings: Record<string, string> = {};
  mappingsSnap.forEach(d => {
    const data = d.data() as any;
    if (data.posItemName && data.productId) {
      confirmedMappings[data.posItemName.toLowerCase()] = data.productId;
    }
  });

  // ── Run NEW matching against every known line ─────────────────────────────
  // Reconstruct all original line objects (name only; no gross)
  const allLines: { name: string }[] = [];
  for (const m of storedMatches) {
    if (m.name != null) allLines.push({ name: m.name });
  }
  for (const u of storedUnknowns) {
    const name = u.line?.name;
    if (name != null) allLines.push({ name });
  }

  // ── Build diff table ───────────────────────────────────────────────────────
  const rows: { name: string; old: string; new_: string; changed: boolean }[] = [];

  for (const ln of allLines) {
    if (isBlankSalesLine(ln)) continue;

    const oldEntry = oldResultByName.get(ln.name.toLowerCase());
    const oldStr = oldEntry === 'UNKNOWN'
      ? 'UNKNOWN'
      : oldEntry
        ? `${oldEntry.productName} [${oldEntry.via}]`
        : 'UNKNOWN';

    const newResult = matchSalesLine({ name: ln.name, qtySold: 0 }, productIndex, confirmedMappings);
    const newStr = newResult
      ? `${newResult.product.name} [${newResult.via}]`
      : 'UNKNOWN';

    rows.push({ name: ln.name, old: oldStr, new_: newStr, changed: oldStr !== newStr });
  }

  // ── Print table ────────────────────────────────────────────────────────────
  const changed = rows.filter(r => r.changed);
  const unchanged = rows.filter(r => !r.changed);

  if (rows.length === 0) {
    console.log('No lines found in stored results.\n');
    return;
  }

  const COL_NAME = Math.min(40, Math.max(12, ...rows.map(r => r.name.length)));
  const COL_RES  = Math.min(50, Math.max(12, ...rows.map(r => Math.max(r.old.length, r.new_.length))));

  function pad(s: string, n: number) { return s.substring(0, n).padEnd(n); }
  const HR = '-'.repeat(COL_NAME + COL_RES * 2 + 8);

  console.log(`${pad('LINE', COL_NAME)}  ${pad('OLD', COL_RES)}  ${pad('NEW', COL_RES)}`);
  console.log(HR);

  for (const r of rows) {
    const marker = r.changed ? ' *' : '  ';
    console.log(`${pad(r.name, COL_NAME)}  ${pad(r.old, COL_RES)}  ${pad(r.new_, COL_RES)}${marker}`);
  }

  console.log(HR);
  console.log(`\nTotal lines: ${rows.length}  |  Changed: ${changed.length}  |  Unchanged: ${unchanged.length}\n`);

  if (changed.length > 0) {
    console.log('CHANGED lines (* rows above):');
    for (const r of changed) {
      const arrow = r.old === 'UNKNOWN' ? 'UNKNOWN → MATCHED'
                  : r.new_ === 'UNKNOWN' ? 'MATCHED → UNKNOWN'
                  : 'REMATCH';
      console.log(`  [${arrow}]  "${r.name}"`);
      console.log(`    OLD: ${r.old}`);
      console.log(`    NEW: ${r.new_}`);
    }
  } else {
    console.log('No changes — new algorithm produces identical results for all stored lines.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
