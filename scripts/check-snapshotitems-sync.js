#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root  = path.join(__dirname, '..');
const files = [
  path.join(root, 'src/utils/snapshotItems.ts'),
  path.join(root, 'web-app/src/utils/snapshotItems.ts'),
  path.join(root, 'functions/src/snapshotItems.ts'),
];

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const contents = files.map(f => stripImports(fs.readFileSync(f, 'utf8')));
const [mobile, web, fn] = contents;
const labels  = ['src/utils/snapshotItems.ts', 'web-app/src/utils/snapshotItems.ts', 'functions/src/snapshotItems.ts'];

if (mobile !== web || mobile !== fn) {
  const diffPair = mobile !== web ? [labels[0], labels[1]] : [labels[0], labels[2]];
  console.error(
    'check:snapshotitems-sync FAILED: non-import content of\n' +
    `  ${diffPair[0]}\nand\n  ${diffPair[1]}\n` +
    'differs. Keep all three files identical except import lines.\n' +
    'Run: cp src/utils/snapshotItems.ts web-app/src/utils/snapshotItems.ts && ' +
    'cp src/utils/snapshotItems.ts functions/src/snapshotItems.ts'
  );
  process.exit(1);
}
console.log('check:snapshotitems-sync passed: all three snapshotItems.ts copies are in sync.');
