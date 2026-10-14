#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root     = path.join(__dirname, '..');
const webSrc   = path.join(root, 'web-app/src/utils/weeklyLedger.ts');
const fnSrc    = path.join(root, 'functions/src/weeklyLedger.ts');
const mobileSrc = path.join(root, 'src/utils/weeklyLedger.ts');

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const web    = fs.readFileSync(webSrc, 'utf8');
const fn     = fs.readFileSync(fnSrc, 'utf8');
const mobile = fs.readFileSync(mobileSrc, 'utf8');

let failed = false;

if (stripImports(web) !== stripImports(fn)) {
  console.error(
    'check:weeklyledger-sync FAILED: non-import content of\n' +
    '  web-app/src/utils/weeklyLedger.ts\n' +
    'and\n' +
    '  functions/src/weeklyLedger.ts\n' +
    'differs. Run: cp web-app/src/utils/weeklyLedger.ts functions/src/weeklyLedger.ts\n' +
    'then verify the import path in functions/src/weeklyLedger.ts is still correct.'
  );
  failed = true;
}

if (stripImports(web) !== stripImports(mobile)) {
  console.error(
    'check:weeklyledger-sync FAILED: non-import content of\n' +
    '  web-app/src/utils/weeklyLedger.ts\n' +
    'and\n' +
    '  src/utils/weeklyLedger.ts\n' +
    'differs. Run: node scripts/sync-weeklyledger.js (or manually copy and fix the import).'
  );
  failed = true;
}

// ── salesFileHash sync (web-app → mobile, identical content) ──────────────
const webHashSrc    = path.join(root, 'web-app/src/utils/salesFileHash.ts');
const mobileHashSrc = path.join(root, 'src/utils/salesFileHash.ts');

const webHash    = fs.readFileSync(webHashSrc, 'utf8');
const mobileHash = fs.readFileSync(mobileHashSrc, 'utf8');

if (webHash !== mobileHash) {
  console.error(
    'check:weeklyledger-sync FAILED: content of\n' +
    '  web-app/src/utils/salesFileHash.ts\n' +
    'and\n' +
    '  src/utils/salesFileHash.ts\n' +
    'differs. Run: cp web-app/src/utils/salesFileHash.ts src/utils/salesFileHash.ts'
  );
  failed = true;
}

if (failed) process.exit(1);
console.log('check:weeklyledger-sync passed: all three weeklyLedger.ts copies and both salesFileHash.ts copies are in sync.');
