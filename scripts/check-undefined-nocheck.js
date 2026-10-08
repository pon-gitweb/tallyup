#!/usr/bin/env node
/**
 * check-undefined-nocheck.js
 *
 * For every file under src/ that contains // @ts-nocheck, compile it with
 * that directive removed IN MEMORY (never edits files) using the TypeScript
 * compiler API, and collect diagnostics 2304 and 2552 ("Cannot find name").
 *
 * Compares against a committed baseline (scripts/nocheck-undefined-baseline.json).
 * FAILS only on NEW findings (net-new name or count increase).
 * Exits 0 when no new findings.
 *
 * Usage:
 *   node scripts/check-undefined-nocheck.js [--generate-baseline]
 *
 * --generate-baseline: prints baseline JSON to stdout and exits 0. Redirect to
 *   scripts/nocheck-undefined-baseline.json to commit it.
 */

'use strict';

const ts   = require('../node_modules/typescript');
const path = require('path');
const fs   = require('fs');

const ROOT         = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'nocheck-undefined-baseline.json');
const GENERATE     = process.argv.includes('--generate-baseline');
const TARGET_CODES = new Set([2304, 2552]);

// React Native globals that are injected at runtime and unknown to tsc
const RN_GLOBALS = new Set(['__DEV__', '__dirname', '__filename', 'global', 'require', 'module', 'exports']);

// ── Load tsconfig ─────────────────────────────────────────────────────────────

const cfgFile = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
if (!cfgFile) { console.error('tsconfig.json not found'); process.exit(2); }
const raw = ts.readConfigFile(cfgFile, ts.sys.readFile);
if (raw.error) { console.error('Error reading tsconfig:', ts.flattenDiagnosticMessageText(raw.error.messageText, '\n')); process.exit(2); }
const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(cfgFile));

// ── Find @ts-nocheck files ────────────────────────────────────────────────────

const nocheckFiles = parsed.fileNames.filter((f) => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel.startsWith('src/_archive/')) return false;
  try {
    const src = fs.readFileSync(f, 'utf8');
    return src.includes('@ts-nocheck');
  } catch { return false; }
});

if (nocheckFiles.length === 0) {
  console.log('check:undefined-nocheck: no @ts-nocheck files found. Passed.');
  process.exit(0);
}

// ── Build a virtual compiler host that strips @ts-nocheck on read ─────────────

const baseHost = ts.createCompilerHost(parsed.options);
const virtualHost = {
  ...baseHost,
  getSourceFile(fileName, languageVersion, onError) {
    const orig = baseHost.getSourceFile(fileName, languageVersion, onError);
    if (!orig) return orig;
    // Strip the nocheck directive so the compiler sees real errors
    const stripped = orig.text.replace(/\/\/\s*@ts-nocheck[^\n]*/g, '// @ts-check-stripped');
    if (stripped === orig.text) return orig;
    return ts.createSourceFile(fileName, stripped, languageVersion, true, orig.scriptKind);
  },
};

// ── Compile only the nocheck files, but include all project files for resolution

const program = ts.createProgram(nocheckFiles, parsed.options, virtualHost);
const allDiags = program.getSemanticDiagnostics();

// ── Collect findings keyed by (relative file, name) ──────────────────────────

/** @type {Map<string, Map<string, number>>} file → name → count */
const findings = new Map();

for (const d of allDiags) {
  if (!d.file) continue;
  if (!TARGET_CODES.has(d.code)) continue;
  const rel = path.relative(ROOT, d.file.fileName).replace(/\\/g, '/');
  if (!nocheckFiles.some(f => path.relative(ROOT, f).replace(/\\/g, '/') === rel)) continue;
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  const match = msg.match(/Cannot find name '([^']+)'/);
  if (!match) continue;
  const name = match[1];
  if (RN_GLOBALS.has(name)) continue;
  if (!findings.has(rel)) findings.set(rel, new Map());
  const byName = findings.get(rel);
  byName.set(name, (byName.get(name) ?? 0) + 1);
}

// ── Serialise ─────────────────────────────────────────────────────────────────

/** @type {Array<{file:string,name:string,count:number}>} */
const current = [];
for (const [file, names] of [...findings.entries()].sort()) {
  for (const [name, count] of [...names.entries()].sort()) {
    current.push({ file, name, count });
  }
}

// ── Generate baseline mode ────────────────────────────────────────────────────

if (GENERATE) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

// ── Load baseline ─────────────────────────────────────────────────────────────

let baseline = [];
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`check:undefined-nocheck: baseline not found at ${BASELINE_PATH}.`);
  console.error('Run: node scripts/check-undefined-nocheck.js --generate-baseline > scripts/nocheck-undefined-baseline.json');
  process.exit(2);
}

// ── Compare: fail only on new findings ───────────────────────────────────────

const baselineMap = new Map(baseline.map(({ file, name, count }) => [`${file}::${name}`, count]));
const newFindings = current.filter(({ file, name, count }) => {
  const baseCount = baselineMap.get(`${file}::${name}`) ?? 0;
  return count > baseCount;
});

if (newFindings.length > 0) {
  console.error(`check:undefined-nocheck FAILED: ${newFindings.length} new undefined-name finding(s) in @ts-nocheck files:`);
  for (const { file, name, count } of newFindings) {
    const base = baselineMap.get(`${file}::${name}`) ?? 0;
    console.error(`  ${file}: '${name}' (baseline ${base}, now ${count})`);
  }
  process.exit(1);
}

console.log(`check:undefined-nocheck passed: ${current.length} baseline finding(s) in ${nocheckFiles.length} @ts-nocheck files; no new ones.`);
process.exit(0);
