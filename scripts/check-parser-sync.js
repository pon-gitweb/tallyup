#!/usr/bin/env node
/**
 * Verifies that src/services/sales/parseSalesExport.ts (canonical) and
 * web-app/src/utils/parseSalesExport.ts (web copy) are byte-for-byte identical.
 *
 * Exits 1 and prints a diff hint if they diverge.
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const CANONICAL = path.join(ROOT, 'src/services/sales/parseSalesExport.ts');
const WEB_COPY  = path.join(ROOT, 'web-app/src/utils/parseSalesExport.ts');

const canonical = fs.readFileSync(CANONICAL, 'utf8');
const webCopy   = fs.readFileSync(WEB_COPY,  'utf8');

if (canonical === webCopy) {
  console.log('check:parser-sync ✓  parseSalesExport.ts files are identical');
  process.exit(0);
} else {
  console.error('check:parser-sync FAIL  parseSalesExport.ts files differ!');
  console.error('  canonical: ' + CANONICAL);
  console.error('  web copy:  ' + WEB_COPY);
  console.error('  Run: cp src/services/sales/parseSalesExport.ts web-app/src/utils/parseSalesExport.ts');
  process.exit(1);
}
