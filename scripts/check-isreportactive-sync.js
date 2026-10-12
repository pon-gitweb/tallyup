#!/usr/bin/env node
/**
 * check:isreportactive-sync — fail if the three copies of isReportActive.ts diverge.
 *
 * Canonical:  src/services/sales/isReportActive.ts
 * Web copy:   web-app/src/utils/isReportActive.ts
 * Functions:  functions/src/isReportActive.ts
 *
 * All three must be byte-for-byte identical so a single edit cannot silently
 * break two of the three environments.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const files = {
  canonical: 'src/services/sales/isReportActive.ts',
  web:       'web-app/src/utils/isReportActive.ts',
  functions: 'functions/src/isReportActive.ts',
};

let ok = true;

const canonical = fs.readFileSync(path.join(ROOT, files.canonical), 'utf8');

for (const [label, rel] of Object.entries(files)) {
  if (label === 'canonical') continue;
  const copy = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (copy !== canonical) {
    console.error(`check:isreportactive-sync FAILED: ${rel} differs from ${files.canonical}`);
    ok = false;
  }
}

if (ok) {
  console.log('check:isreportactive-sync passed: all three copies are identical.');
} else {
  process.exit(1);
}
