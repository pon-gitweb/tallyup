#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const root  = path.join(__dirname, '..');
const files = [
  path.join(root, 'src/utils/productSnapshotItems.ts'),
  path.join(root, 'web-app/src/utils/productSnapshotItems.ts'),
  path.join(root, 'functions/src/productSnapshotItems.ts'),
];

function stripImports(src) {
  return src.split('\n').filter(l => !l.trimStart().startsWith('import ')).join('\n');
}

const contents = files.map(f => stripImports(fs.readFileSync(f, 'utf8')));
const [mobile, web, fn] = contents;
const labels  = ['src/utils/productSnapshotItems.ts', 'web-app/src/utils/productSnapshotItems.ts', 'functions/src/productSnapshotItems.ts'];

if (mobile !== web || mobile !== fn) {
  const diffPair = mobile !== web ? [labels[0], labels[1]] : [labels[0], labels[2]];
  console.error(
    'check:productsnapshotitems-sync FAILED: non-import content of\n' +
    `  ${diffPair[0]}\nand\n  ${diffPair[1]}\n` +
    'differs. Keep all three files identical except import lines.\n' +
    'Run: cp src/utils/productSnapshotItems.ts web-app/src/utils/productSnapshotItems.ts && ' +
    'cp src/utils/productSnapshotItems.ts functions/src/productSnapshotItems.ts'
  );
  process.exit(1);
}
console.log('check:productsnapshotitems-sync passed: all three productSnapshotItems.ts copies are in sync.');
