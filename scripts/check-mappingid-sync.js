#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const mobile  = path.join(root, 'src/utils/mappingId.ts');
const web     = path.join(root, 'web-app/src/utils/mappingId.ts');

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const mobileContent = stripImports(fs.readFileSync(mobile, 'utf8'));
const webContent    = stripImports(fs.readFileSync(web,    'utf8'));

if (mobileContent !== webContent) {
  console.error(
    'check:mappingid-sync FAILED: non-import content of\n' +
    '  src/utils/mappingId.ts\n' +
    'and\n' +
    '  web-app/src/utils/mappingId.ts\n' +
    'differs. Keep both files identical except for import lines and the doc-comment reference.\n' +
    'Run: cp src/utils/mappingId.ts web-app/src/utils/mappingId.ts'
  );
  process.exit(1);
}

console.log('check:mappingid-sync passed: both mappingId.ts copies are in sync.');
