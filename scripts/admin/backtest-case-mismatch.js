#!/usr/bin/env node
/**
 * backtest-case-mismatch.js — read-only backtest for the pack-size detector.
 *
 * Answers three questions:
 *   (b) How many product names parse as pack size >= 4?
 *       (These products are at risk of having absorbed a case price as a unit price.)
 *   (c) In stored priceChangeFlags (changePercent > 50), how many would the NEW
 *       detector flag versus the old one? How many look like false positives?
 *
 * No writes. No deploys. Reads only.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/... \
 *   node scripts/admin/backtest-case-mismatch.js --project tallyup-f1463
 */

'use strict';

const admin = require('firebase-admin');
const process = require('process');

// ── parsePackUnits (JS mirror of functions/src/detectCaseMismatch.ts) ─────────

const UNIT_SUFFIX = /^(ml|cl|fl|oz|l\b|ltr\b|kg\b|g\b|mg\b|mm\b|cm\b)/i;

function parsePackUnits(name) {
  const s = name.toLowerCase();
  const xRe = /(?<![a-z\d])(\d+)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*([a-z]+)?/;
  const xMatch = s.match(xRe);
  if (xMatch) {
    const a = parseInt(xMatch[1], 10);
    const bRaw = xMatch[2];
    const suffix = xMatch[3] || '';
    const hasUnit = UNIT_SUFFIX.test(suffix);
    if (hasUnit) {
      if (a >= 2 && a <= 96) return { units: a, source: 'count' };
    } else {
      const b = parseInt(bRaw, 10);
      const product = a * b;
      if (product >= 2 && product <= 96) return { units: product, source: 'multiplied' };
    }
  }
  const EXPLICIT = [
    /\bcase\s+of\s+(\d+)/, /(\d+)\s+per\s+case\b/, /\bctn\s+(\d+)/,
    /(\d+)\s*pk\b/, /(\d+)\s+pack\b/, /\bx\s*(\d+)\b/, /(\d+)\s+cases?\b/,
  ];
  for (const re of EXPLICIT) {
    const m = s.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 96) return { units: n, source: 'explicit' };
    }
  }
  return null;
}

// ── old detector (mirrors proposeInvoiceChanges lines 591-615) ────────────────

function oldDetector(unitPrice, existing, productCaseSize) {
  if (!existing || !unitPrice) return null;
  const pctDiff = Math.abs((unitPrice - existing) / existing);
  if (pctDiff <= 0.5) return null;
  const candidates = (typeof productCaseSize === 'number' && productCaseSize > 0)
    ? [productCaseSize] : [6, 12, 24];
  const ratio = unitPrice / existing;
  for (const c of candidates) {
    if (Math.abs(ratio - c) / c <= 0.15) return c;
  }
  return null;
}

// ── new detector (JS mirror of detectCaseMismatch.ts) ────────────────────────

const RATIO_CANDIDATES = [4, 6, 8, 10, 12, 15, 18, 20, 24, 30, 36, 48];

function nearestCandidate(ratio) {
  return RATIO_CANDIDATES.reduce((best, c) =>
    Math.abs(ratio - c) < Math.abs(ratio - best) ? c : best);
}

function newDetector(unitPrice, existing, name, productCaseSize) {
  if (!existing || !unitPrice || existing <= 0 || unitPrice <= 0) return null;
  const ratio = unitPrice / existing;
  if (ratio <= 1.5) return null;
  const parsed = parsePackUnits(name || '');
  if (parsed && parsed.units > 1 && ratio > Math.sqrt(parsed.units)) return { guess: parsed.units, reason: 'name_pack' };
  if (typeof productCaseSize === 'number' && productCaseSize > 1 && ratio > Math.sqrt(productCaseSize)) return { guess: productCaseSize, reason: 'case_size' };
  const nearest = nearestCandidate(ratio);
  if (Math.abs(ratio - nearest) / nearest <= 0.15) return { guess: nearest, reason: 'ratio_candidate' };
  if (ratio >= 4) return { guess: nearest, reason: 'big_jump' };
  return null;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const project = process.argv.includes('--project')
    ? process.argv[process.argv.indexOf('--project') + 1]
    : 'tallyup-f1463';

  admin.initializeApp({ projectId: project });
  const db = admin.firestore();

  console.log(`\n=== Backtest: pack-size detector | project: ${project} ===\n`);

  // ── (b) Products with parse-able pack name ──────────────────────────────────

  console.log('--- (b) Products whose name encodes a pack size >= 4 ---');
  let totalProducts = 0;
  let packNameProducts = 0;
  const packExamples = [];

  const venuesSnap = await db.collection('venues').limit(200).get();
  console.log(`Scanning ${venuesSnap.size} venues…`);

  for (const venueDoc of venuesSnap.docs) {
    const venueId = venueDoc.id;
    const productsSnap = await db.collection(`venues/${venueId}/products`).get();
    for (const p of productsSnap.docs) {
      const data = p.data();
      const name = (data.name || '').trim();
      if (!name) continue;
      totalProducts++;
      const parsed = parsePackUnits(name);
      if (parsed && parsed.units >= 4) {
        packNameProducts++;
        if (packExamples.length < 10) {
          packExamples.push({
            venue: venueId.slice(0, 8) + '…',
            name,
            packUnits: parsed.units,
            source: parsed.source,
            costPrice: data.costPrice ?? null,
            costPriceSource: data.costPriceSource ?? null,
          });
        }
      }
    }
  }

  console.log(`  Total products scanned : ${totalProducts}`);
  console.log(`  Pack-name products (N≥4): ${packNameProducts}`);
  console.log(`  Examples:`);
  for (const e of packExamples) {
    console.log(`    [${e.venue}] "${e.name}" N=${e.packUnits} (${e.source}) costPrice=${e.costPrice} src=${e.costPriceSource}`);
  }

  // ── (c) priceChangeFlags comparison ────────────────────────────────────────

  console.log('\n--- (c) priceChangeFlags with changePercent > 50 ---');
  let flagsTotal = 0;
  let oldFlagged = 0;
  let newFlagged = 0;
  let newOnly = 0;
  let oldOnly = 0;
  const newOnlyExamples = [];
  const likelyFalsePositives = [];

  for (const venueDoc of venuesSnap.docs) {
    const venueId = venueDoc.id;
    const flagsSnap = await db.collection(`venues/${venueId}/priceChangeFlags`)
      .where('changePercent', '>', 50)
      .limit(500)
      .get();

    for (const flagDoc of flagsSnap.docs) {
      const d = flagDoc.data();
      const oldPrice = typeof d.oldPrice === 'number' ? d.oldPrice : null;
      const newPrice = typeof d.newPrice === 'number' ? d.newPrice : null;
      const productName = d.productName || d.lineName || '';
      const productCaseSize = typeof d.productCaseSize === 'number' ? d.productCaseSize : null;

      if (!oldPrice || !newPrice || oldPrice <= 0) continue;
      flagsTotal++;

      const oldResult = oldDetector(newPrice, oldPrice, productCaseSize);
      const newResult = newDetector(newPrice, oldPrice, productName, productCaseSize);

      if (oldResult) oldFlagged++;
      if (newResult) newFlagged++;

      if (newResult && !oldResult) {
        newOnly++;
        if (newOnlyExamples.length < 10) {
          newOnlyExamples.push({
            venue: venueId.slice(0, 8) + '…',
            name: productName,
            oldPrice,
            newPrice,
            ratio: (newPrice / oldPrice).toFixed(2),
            reason: newResult.reason,
            guess: newResult.guess,
          });
        }
      }

      if (oldResult && !newResult) oldOnly++;

      // Estimate false positive: big_jump with no name cue and no case_size
      if (newResult && newResult.reason === 'big_jump') {
        if (likelyFalsePositives.length < 5) {
          likelyFalsePositives.push({
            name: productName, oldPrice, newPrice,
            ratio: (newPrice / oldPrice).toFixed(2),
          });
        }
      }
    }
  }

  console.log(`  Total flags (changePercent > 50): ${flagsTotal}`);
  console.log(`  Old detector flagged             : ${oldFlagged}`);
  console.log(`  New detector flagged             : ${newFlagged}`);
  console.log(`  New only (missed by old)         : ${newOnly}`);
  console.log(`  Old only (no longer flagged)     : ${oldOnly}`);
  console.log(`  New 'big_jump' flags (FP risk)   : ${likelyFalsePositives.length} shown`);
  if (likelyFalsePositives.length) {
    for (const e of likelyFalsePositives) {
      console.log(`    "${e.name}" ${e.oldPrice} → ${e.newPrice} (${e.ratio}×)`);
    }
  }
  console.log(`\n  New-only examples:`);
  for (const e of newOnlyExamples) {
    console.log(`    [${e.venue}] "${e.name}" ${e.oldPrice} → ${e.newPrice} (${e.ratio}×) → ${e.reason} guess=${e.guess}`);
  }

  console.log('\nDone. No writes made.\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
