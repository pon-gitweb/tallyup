#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root  = path.join(__dirname, '..');
const fnSrc = path.join(root, 'functions/src/productSize.ts');
const webSrc = path.join(root, 'web-app/src/utils/productSize.ts');

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const fnContent  = stripImports(fs.readFileSync(fnSrc,  'utf8'));
const webContent = stripImports(fs.readFileSync(webSrc, 'utf8'));

if (fnContent !== webContent) {
  console.error(
    'check:productsize-sync FAILED: non-import content of\n' +
    '  functions/src/productSize.ts\n' +
    'and\n' +
    '  web-app/src/utils/productSize.ts\n' +
    'differs. Keep both files identical except for import lines.\n' +
    'Run: cp functions/src/productSize.ts web-app/src/utils/productSize.ts'
  );
  process.exit(1);
}

console.log('check:productsize-sync passed: both productSize.ts copies are in sync.');
