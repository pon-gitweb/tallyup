const fs = require('fs');

const file = 'index.js';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// A) Normalize pdf-parse import to a robust form
// Target patterns:
//   const pdfParse = require('pdf-parse');
//   const { default: pdfParse } = require('pdf-parse');
if (!/const\s+pdfParse\s*=/.test(src) || /pdfParseModule/.test(src) === false) {
  // Replace destructured default form first
  const reDestr = /^\s*const\s*\{\s*default\s*:\s*pdfParse\s*\}\s*=\s*require\(['"]pdf-parse['"]\);\s*$/m;
  if (reDestr.test(src)) {
    src = src.replace(reDestr,
`const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;`);
    changed = true;
  }
  // Replace simple require form
  const reSimple = /^\s*const\s*pdfParse\s*=\s*require\(['"]pdf-parse['"]\);\s*$/m;
  if (reSimple.test(src)) {
    src = src.replace(reSimple,
`const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;`);
    changed = true;
  }
}

// B) Remove duplicate inline admin.initializeApp() lines (top-level init already exists)
const reDupAdmin = /^\s*if\s*\(!admin\.apps\.length\)\s*admin\.initializeApp\(\);\s*$/gm;
if (reDupAdmin.test(src)) {
  src = src.replace(reDupAdmin, '');
  changed = true;
}

// Only write if changed
if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[fix] functions/index.js updated');
} else {
  console.log('[fix] no changes needed');
}
