const fs = require('fs');
const file = 'index.js';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// 1) Normalize any pdf-parse import into a robust 2-line form
//    - const pdfParse = require('pdf-parse');
//    - const { default: pdfParse } = require('pdf-parse');
//    - or anything containing require('pdf-parse')
const lines = src.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (/require\(['"]pdf-parse['"]\)/.test(lines[i])) {
    // Replace this line with the robust form (and remove any existing const pdfParse on this line)
    lines[i] = "const pdfParseModule = require('pdf-parse');";
    // Insert the assignment on the next line if not already present nearby
    const next = lines[i+1] || '';
    if (!/const\s+pdfParse\s*=/.test(next)) {
      lines.splice(i+1, 0, "const pdfParse = pdfParseModule.default || pdfParseModule;");
    }
    changed = true;
    // Remove any duplicate const pdfParse declarations that might appear on the same or next lines
    // (Handled by the replacement above.)
  }
}
let out = lines.join('\n');

// 2) Remove duplicate admin.initializeApp lines (you already initialize at top)
out = out.replace(/^\s*if\s*\(!admin\.apps\.length\)\s*admin\.initializeApp\(\);\s*$/gm, () => {
  changed = true;
  return '';
});

if (changed) {
  fs.writeFileSync(file, out, 'utf8');
  console.log('[fix] functions/index.js updated');
} else {
  console.log('[fix] no changes needed');
}
