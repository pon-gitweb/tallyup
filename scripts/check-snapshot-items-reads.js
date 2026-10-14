#!/usr/bin/env node
/**
 * Preflight: fail if any non-test file outside the loader reads .items from
 * a Firestore snapshot document without going through loadSnapshotItems.
 *
 * Strategy:
 *   1. Track variables assigned from .data() calls within each file.
 *   2. Flag .items access on those variables.
 *   3. Also flag the direct pattern  .data() ... .items  on the same line.
 *   4. Skip lines with "snapshot-items-ok" (pure-function params, pre-loaded).
 *   5. Whitelist snapshotWriter.ts legacy write, loader, and test files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SKIP_PATHS = [
  'snapshotItems.ts',
  '__tests__',
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
  'node_modules',
  // Non-snapshot .items reads (recipes, POS, Stripe, etc.)
  'src/services/recipes/',
  'src/services/pos/',
  'functions/src/priceCascade.ts',
  'web-app/src/pages/CraftItPage.tsx',
];

// Pattern: const/let/var NAME = ...something.data()...
// Captures the variable name assigned from a .data() call.
const ASSIGN_FROM_DATA = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^=;\n]*\.data\(\)/;

// Pattern: .items or ['items'] access following a .data() call on the same line
const INLINE_DATA_ITEMS = /\.data\(\)\s*(?:as\s+\w+\s*)?(?:\((?:as\s+\w+)?\s*\))?\s*[.[](?:items|['"]items['"])/;

// Pattern: variable.items or variable['items']
function makeVarItemsRe(varName) {
  return new RegExp(`\\b${varName}\\s*(?:\\.\\s*items\\b|\\[['"]items['"]\\])`);
}

function shouldSkip(filePath) {
  const rel = path.relative(ROOT, filePath);
  return SKIP_PATHS.some(p => rel.includes(p));
}

function checkFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const findings = [];

  // Collect all variables assigned from .data() in this file
  const dataVars = new Set();
  for (const line of lines) {
    const m = ASSIGN_FROM_DATA.exec(line);
    if (m) dataVars.add(m[1]);
  }

  // Build per-variable regex patterns once
  const varPatterns = Array.from(dataVars).map(v => ({ name: v, re: makeVarItemsRe(v) }));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Allowed: explicitly marked safe
    if (line.includes('snapshot-items-ok')) continue;

    // Allowed: snapshotWriter legacy write line
    if (rel.includes('snapshotWriter') && /items\s*:\s*cleanItems/.test(line)) continue;

    // Allowed: .items.data (Stripe subscription items pattern, not snapshot items)
    if (/\.items\s*\?\.\s*data\b|\.items\.data\b/.test(line)) continue;

    // Allowed: BatchRecipeItem / Array.isArray checks on non-snapshot data
    if (/BatchRecipeItem|Array\.isArray.*\.items/.test(line)) continue;

    // Check inline: .data()...items on same line
    if (INLINE_DATA_ITEMS.test(line)) {
      findings.push({ line: i + 1, text: line.trim() });
      continue;
    }

    // Check tracked data variables
    for (const { re } of varPatterns) {
      if (re.test(line)) {
        findings.push({ line: i + 1, text: line.trim() });
        break;
      }
    }
  }

  return findings;
}

function walkDir(dir, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(full, results);
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (!shouldSkip(full)) {
        const findings = checkFile(full);
        if (findings.length > 0) results.push({ file: path.relative(ROOT, full), findings });
      }
    }
  }
}

const results = [];
for (const dir of ['src', 'functions/src', 'web-app/src']) {
  walkDir(path.join(ROOT, dir), results);
}

if (results.length === 0) {
  console.log('check-snapshot-items-reads: OK');
  process.exit(0);
}

console.error('\n[FAIL] check-snapshot-items-reads: snapshot .items reads found outside loader\n');
for (const { file, findings } of results) {
  console.error(`  ${file}`);
  for (const { line, text } of findings) {
    console.error(`    line ${line}: ${text}`);
  }
}
console.error(`
Fix: replace direct .items access with:
  const items = await loadSnapshotItems(data, () =>
    getDocs(collection(ref, 'itemChunks')).then(s =>
      s.docs.map(d => d.data() as { index: number; items: any[] })
    )
  )
Or add // snapshot-items-ok on the line if the variable's items are already pre-loaded by caller.
`);
process.exit(1);
