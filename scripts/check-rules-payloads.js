#!/usr/bin/env node
/**
 * Static check: for each (collection, appFile, rulesExtract) entry, verify
 * that every top-level key the app writes in addDoc is allowed by the
 * Firestore security rules hasOnlyFields() list for that collection's CREATE.
 *
 * Exits 1 if any write includes a key not in the rules list.
 * Exits 1 if the rules file or any app file cannot be read.
 *
 * To add a new entry, push to CHECKS below.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Entries to check ──────────────────────────────────────────────────────────
// Each entry:
//   collection   – human label (for error messages)
//   appFiles     – array of source files that call addDoc for this collection
//   rulesFile    – path to firestore.rules (relative to ROOT)
//   rulesPattern – regex that captures the hasOnlyFields list for this collection's
//                  CREATE rule (first capture group = comma-separated quoted strings)
//   extractKeys  – function(src) → string[] of top-level keys written in addDoc

const CHECKS = [
  {
    collection: 'salesReports',
    appFiles: [
      'src/services/sales/storeSalesReport.ts',
      'web-app/src/pages/ImportPage.tsx',
    ],
    rulesFile: 'firestore.rules',
    // Matches: hasOnlyFields(request.resource.data, ['key1','key2',...])
    // inside the salesReports CREATE block.
    extractRulesKeys(rulesText) {
      // Find the salesReports CREATE allow block and extract its hasOnlyFields list.
      const block = rulesText.match(
        /match\s+\/salesReports\/\{[^}]+\}[^}]*?allow\s+create[^;]+;/s
      );
      if (!block) return null;
      const listMatch = block[0].match(/hasOnlyFields\s*\(\s*request\.resource\.data\s*,\s*\[([^\]]+)\]/);
      if (!listMatch) return null;
      return listMatch[1]
        .split(',')
        .map(s => s.replace(/['"'\s]/g, ''))
        .filter(Boolean);
    },
    extractAppKeys(src) {
      // Find addDoc( collection(..., 'salesReports'), { ... }) calls and
      // extract the immediate top-level keys of the object literal.
      // This is a conservative regex — it finds lines like `  key: value,`
      // inside the addDoc object.  We look between addDoc( and the first });
      const keys = new Set();
      // Match each addDoc salesReports call
      const addDocRe = /addDoc\s*\(\s*collection\s*\([^)]+['"]salesReports['"]\s*\)\s*,\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
      let m;
      while ((m = addDocRe.exec(src)) !== null) {
        const body = m[1];
        // Extract top-level keys: lines starting with an identifier followed by :
        const keyRe = /^\s{0,8}(\w+)\s*:/gm;
        let km;
        while ((km = keyRe.exec(body)) !== null) {
          keys.add(km[1]);
        }
      }
      return [...keys];
    },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

let failed = false;

for (const check of CHECKS) {
  const rulesText = fs.readFileSync(path.join(ROOT, check.rulesFile), 'utf8');
  const allowedKeys = check.extractRulesKeys(rulesText);
  if (!allowedKeys || allowedKeys.length === 0) {
    console.error(`check:rules-payloads FAIL  Could not extract hasOnlyFields list for ${check.collection} from ${check.rulesFile}`);
    failed = true;
    continue;
  }
  const allowedSet = new Set(allowedKeys);

  for (const appFile of check.appFiles) {
    const src = fs.readFileSync(path.join(ROOT, appFile), 'utf8');
    const writtenKeys = check.extractAppKeys(src);
    const violations = writtenKeys.filter(k => !allowedSet.has(k));
    if (violations.length > 0) {
      console.error(
        `check:rules-payloads FAIL  ${appFile} writes top-level key(s) not in ` +
        `${check.collection} CREATE rule: ${violations.join(', ')}`
      );
      console.error(`  Allowed: ${[...allowedSet].join(', ')}`);
      console.error(`  Written: ${writtenKeys.join(', ')}`);
      failed = true;
    } else {
      console.log(
        `check:rules-payloads ✓  ${appFile} (${check.collection}) — ` +
        `keys: ${writtenKeys.join(', ')}`
      );
    }
  }
}

process.exit(failed ? 1 : 0);
