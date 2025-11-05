const fs = require('fs');
const path = 'index.js';
let src = fs.readFileSync(path, 'utf8');
let changed = false;

// Remove ALL existing pdf-parse import/assign lines (any shape)
let out = src
  .replace(/^\s*const\s+\{\s*default\s*:\s*pdfParse\s*\}\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParse\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParseModule\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '');
if (out !== src) { src = out; changed = true; }

// Find "const admin = require('firebase-admin');" and insert robust import right after it
const adminLine = /^(.*const\s+admin\s*=\s*require\(['"]firebase-admin['"]\);\s*)$/m;
if (!adminLine.test(src)) {
  console.error('[fixPdfOnce] Could not find firebase-admin require line. Aborting to avoid corrupting file.');
  process.exit(1);
}
if (!/pdfParseModule\.default \|\| pdfParseModule/.test(src)) {
  src = src.replace(adminLine, `$1
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;`);
  changed = true;
}

// Remove stray duplicate admin.initializeApp lines (top init already present)
out = src.replace(/^\s*if\s*\(!admin\.apps\.length\)\s*admin\.initializeApp\(\);\s*$/gm, '');
if (out !== src) { src = out; changed = true; }

if (changed) {
  fs.writeFileSync(path, src, 'utf8');
  console.log('[fixPdfOnce] functions/index.js updated');
} else {
  console.log('[fixPdfOnce] no changes needed');
}
