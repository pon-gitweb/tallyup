#!/usr/bin/env node
'use strict';

/**
 * check-nav-targets.js
 *
 * Fails if any nav.reset() call in src/ references a route name that is not
 * registered as a Stack.Screen or Tab.Screen name in src/navigation/.
 *
 * Usage:  node scripts/check-nav-targets.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const NAV_DIR = path.join(ROOT, 'src', 'navigation');
const SRC_DIR = path.join(ROOT, 'src');

const SKIP_PATTERNS = ['_archive', '.bak', '.backup', 'node_modules', '.backup'];

// ── helpers ────────────────────────────────────────────────────────────────────

function walkFiles(dir, exts) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_PATTERNS.some(p => e.name.includes(p))) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some(x => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

// ── 1. Collect all registered route names from navigation files ────────────────

const navFiles = walkFiles(NAV_DIR, ['.tsx', '.ts']);
const registered = new Set();

for (const f of navFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // Match: <Stack.Screen name="X" or <Tab.Screen name="X"
  const re = /<(?:Stack|Tab)\.Screen\b[^>]*\bname=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) registered.add(m[1]);
}

if (registered.size === 0) {
  console.error('check:nav-targets — no registered routes found; check nav dir path');
  process.exit(1);
}

// ── 2. Find all nav.reset({ routes: [{ name: '...' }] }) in src/ ──────────────

const srcFiles = walkFiles(SRC_DIR, ['.tsx', '.ts']);
const violations = [];

for (const f of srcFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const resetRe = /\bnav(?:igation)?\.reset\s*\(/g;
  let m;
  while ((m = resetRe.exec(src)) !== null) {
    // Grab up to 500 chars after .reset( to find route names
    const region = src.slice(m.index, m.index + 500);
    const nameRe = /\bname:\s*['"`]([^'"`]+)['"`]/g;
    let nm;
    while ((nm = nameRe.exec(region)) !== null) {
      const route = nm[1];
      if (!registered.has(route)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push({ file: path.relative(ROOT, f), line, route });
      }
    }
  }
}

// ── 3. Report ──────────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log(`check:nav-targets passed — ${registered.size} routes registered, all reset targets valid.`);
  process.exit(0);
} else {
  console.error('check:nav-targets FAILED — nav.reset() uses unregistered route names:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  "${v.route}" not in any navigator`);
  }
  process.exit(1);
}
