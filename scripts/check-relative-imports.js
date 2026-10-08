#!/usr/bin/env node
/**
 * check:imports - fail if any relative import/require in the app code points at a
 * file that does not exist. Metro fails the Android/iOS bundle on these, but jest
 * only resolves the modules a test actually imports, and tsc skips @ts-nocheck
 * files, so a wrong path in an untested screen otherwise surfaces only on EAS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.cjs', '.mjs'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '_archive', '.git']);
// Known-dead files (nothing imports them, so Metro never resolves these). Delete the files
// when convenient and remove the entries. Do NOT add live code here.
const ALLOW = new Set([
  'src/screens/BetaWelcomeScreen.tsx::../assets/icon.png',
  'src/services/catalogSafe.ts::./catalog',
]);
const RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]*)\1/g;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(name.name)) continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name.name) && !/\.test\.|\.spec\./.test(name.name)) out.push(p);
  }
}

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const e of EXTS) if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return true;
  for (const e of EXTS.slice(1)) if (fs.existsSync(path.join(base, 'index' + e))) return true;
  return false;
}

const files = [];
walk(path.join(ROOT, 'src'), files);
for (const f of ['App.tsx', 'index.js', 'index.ts']) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));

const bad = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = RE.exec(text))) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (!resolves(f, m[2]) && !ALLOW.has(rel + '::' + m[2])) bad.push({ file: rel, line: text.slice(0, m.index).split('\n').length, spec: m[2] });
  }
}

if (bad.length) {
  console.error(`check:imports FAILED: ${bad.length} relative import(s) point at files that do not exist:`);
  for (const b of bad) console.error(`  ${b.file}:${b.line}  ->  '${b.spec}'`);
  process.exit(1);
}
console.log(`check:imports passed: every relative import resolves (${files.length} files scanned).`);
