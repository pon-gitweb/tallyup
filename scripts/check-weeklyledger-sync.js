#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root   = path.join(__dirname, '..');
const webSrc = path.join(root, 'web-app/src/utils/weeklyLedger.ts');
const fnSrc  = path.join(root, 'functions/src/weeklyLedger.ts');

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const web = fs.readFileSync(webSrc, 'utf8');
const fn  = fs.readFileSync(fnSrc, 'utf8');

if (stripImports(web) !== stripImports(fn)) {
  console.error(
    'check:weeklyledger-sync FAILED: non-import content of\n' +
    '  web-app/src/utils/weeklyLedger.ts\n' +
    'and\n' +
    '  functions/src/weeklyLedger.ts\n' +
    'differs. Run: cp web-app/src/utils/weeklyLedger.ts functions/src/weeklyLedger.ts\n' +
    'then verify the import path in functions/src/weeklyLedger.ts is still correct.'
  );
  process.exit(1);
}
console.log('check:weeklyledger-sync passed: weeklyLedger.ts files are in sync (import lines excluded).');
