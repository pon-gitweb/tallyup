const fs = require('fs');
const path = 'index.js';
let src = fs.readFileSync(path, 'utf8');
let changed = false;

// 1) Wipe ALL existing pdf-parse import lines (no matter the shape)
const before = src;
src = src
  .replace(/^\s*const\s+\{\s*default\s*:\s*pdfParse\s*\}\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParse\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParseModule\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '');
if (src !== before) changed = true;

// 2) Insert robust two-line import once, just above the callable definition
const anchor = /\/\/\s*----\s*processInvoicesPdf\s*\(callable\)\s*----/;
if (anchor.test(src) && !/pdfParseModule\.default \|\| pdfParseModule/.test(src)) {
  src = src.replace(anchor, `// ---- processInvoicesPdf (callable) ----
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;
`);
  changed = true;
}

// 3) Remove duplicate inline admin init below (top-level init already exists)
const cleaned = src.replace(/^\s*if\s*\(!admin\.apps\.length\)\s*admin\.initializeApp\(\);\s*$/gm, '');
if (cleaned !== src) { src = cleaned; changed = true; }

// 4) Ensure we didn’t accidentally remove all imports (fallback: add at top if anchor missing)
if (!/pdfParseModule\.default \|\| pdfParseModule/.test(src)) {
  src = `const pdfParseModule = require('pdf-parse');\nconst pdfParse = pdfParseModule.default || pdfParseModule;\n` + src;
  changed = true;
}

if (changed) {
  fs.writeFileSync(path, src, 'utf8');
  console.log('[forceFixPdfImport] index.js updated');
} else {
  console.log('[forceFixPdfImport] no changes needed');
}
