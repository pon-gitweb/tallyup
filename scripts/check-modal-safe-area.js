#!/usr/bin/env node
/**
 * check-modal-safe-area.js
 *
 * Fails if a non-transparent <Modal> in src/ has no safe-area handling
 * (SafeAreaView, useSafeAreaInsets, or FullScreenModalFrame).
 *
 * Allowlisted paths are exempt (festival screens + files confirmed to not need it).
 *
 * Usage:
 *   node scripts/check-modal-safe-area.js
 *
 * Exit 0 = all clear.  Exit 1 = violations found.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

// Files/directories whose Modals are intentionally exempt.
// Festival screens have their own safe-area handling strategy (pageSheet + camera UIs).
const ALLOWLIST = [
  'src/screens/festival/',
  'src/components/festival/',
];

// A file is safe if it contains at least one of these patterns.
const SAFE_AREA_RE = [
  /SafeAreaView/,
  /useSafeAreaInsets/,
  /FullScreenModalFrame/,
];

// A <Modal> is transparent (overlay) if the same JSX element has transparent={true} or transparent.
// We detect this by checking whether "transparent" appears as a prop on the Modal opening tag.
function isTransparentModal(src, modalIdx) {
  // Find the end of the opening tag: either /> or > (whichever comes first).
  const tagEnd = (() => {
    let depth = 0;
    for (let i = modalIdx; i < src.length; i++) {
      if (src[i] === '<') depth++;
      if (src[i] === '>') {
        depth--;
        if (depth === 0) return i;
      }
      // self-closing
      if (src[i] === '/' && src[i + 1] === '>') return i + 1;
    }
    return src.length;
  })();
  const tag = src.slice(modalIdx, tagEnd);
  // transparent is a boolean prop: either transparent={true} or just the word "transparent" alone
  return /\btransparent\b/.test(tag);
}

function hasSafeArea(src) {
  return SAFE_AREA_RE.some(re => re.test(src));
}

function isAllowlisted(relPath) {
  return ALLOWLIST.some(p => relPath.replace(/\\/g, '/').startsWith(p));
}

function walkDir(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_archive' || entry.name === 'node_modules' || entry.name === '.git') continue;
      walkDir(full, results);
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith('.test.tsx') && !entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = walkDir(SRC_DIR);
const violations = [];

for (const filePath of files) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (isAllowlisted(rel)) continue;

  const src = fs.readFileSync(filePath, 'utf8');

  // Does this file have any <Modal?
  if (!/<Modal[\s>]/.test(src)) continue;

  // Does it have any non-transparent <Modal?
  let hasNonTransparentModal = false;
  const re = /<Modal[\s>]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!isTransparentModal(src, m.index)) {
      hasNonTransparentModal = true;
      break;
    }
  }
  if (!hasNonTransparentModal) continue;

  // Check for safe-area handling
  if (!hasSafeArea(src)) {
    violations.push(rel);
  }
}

if (violations.length === 0) {
  console.log('check:modal-safe-area: all non-transparent Modals have safe-area handling. ✓');
  process.exit(0);
} else {
  console.error('check:modal-safe-area: FAIL — the following files have a non-transparent <Modal> with no safe-area handling:');
  violations.forEach(v => console.error('  ' + v));
  console.error('\nFix: wrap the Modal\'s content with <FullScreenModalFrame> or add useSafeAreaInsets.');
  console.error('If this screen is genuinely exempt, add its path to the ALLOWLIST in scripts/check-modal-safe-area.js.');
  process.exit(1);
}
