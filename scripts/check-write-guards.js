#!/usr/bin/env node
/**
 * check:write-guards — fail if a non-onboarding file writes to a guarded Firestore
 * collection without importing useWriteGuard.
 *
 * Guarded collections: products, departments, areas, orders, invoices, stockTakes, suppliers
 * Write ops checked: setDoc, updateDoc, addDoc, writeBatch, deleteDoc, runTransaction
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── patterns ────────────────────────────────────────────────────────────────

const WRITE_OPS = /\b(setDoc|updateDoc|addDoc|writeBatch|deleteDoc|runTransaction)\s*\(/;

const GUARDED_COLLECTIONS =
  /'(products|departments|areas|orders|invoices|stockTakes|suppliers)'/;

const HAS_GUARD = /useWriteGuard/;

// ── allowlist (paths that are intentionally unguarded) ──────────────────────

const ALLOWLIST_PATTERNS = [
  // Onboarding / venue-creation flows
  /CreateVenueScreen/,
  /BringYourDataScreen/,
  /InventoryImportPreviewScreen/,
  /InventoryImportScreen/,
  /setup[/\\]steps[/\\]/,
  // Festival-mode files (always allowed by evaluateWriteGuard itself)
  /festival/i,
  // Reads from guarded collections but writes only to non-guarded ones (verified)
  /DashboardScreen/,
  /ReportsIndexScreen/,
  // Snapshot / migration scripts outside app code
  /scripts[/\\]/,
];

function isAllowlisted(filePath) {
  return ALLOWLIST_PATTERNS.some(p => p.test(filePath));
}

// ── directory walker ─────────────────────────────────────────────────────────

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip node_modules and hidden dirs
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, results);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '..');
const searchDirs = [
  path.join(root, 'src', 'screens'),
  path.join(root, 'src', 'components'),
];

const violations = [];

for (const dir of searchDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (isAllowlisted(file)) continue;

    const src = fs.readFileSync(file, 'utf8');

    const hasWrite = WRITE_OPS.test(src);
    const hasGuardedCollection = GUARDED_COLLECTIONS.test(src);

    if (hasWrite && hasGuardedCollection && !HAS_GUARD.test(src)) {
      violations.push(path.relative(root, file));
    }
  }
}

if (violations.length === 0) {
  console.log(`check:write-guards passed: all ${searchDirs.map(d => path.relative(root, d)).join(', ')} files with guarded-collection writes have useWriteGuard.`);
  process.exit(0);
} else {
  console.error('check:write-guards FAILED: the following files write to guarded collections without useWriteGuard:\n');
  for (const v of violations) console.error('  ' + v);
  console.error('\nAdd useWriteGuard(<action>) to each file, or add it to the allowlist in scripts/check-write-guards.js if it is intentionally unguarded.');
  process.exit(1);
}
