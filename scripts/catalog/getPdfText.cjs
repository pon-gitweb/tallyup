const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pdfParse = require('pdf-parse'); // v1.1.1 exposes a function

module.exports = async function getPdfText(buf, filenameForLog='') {
  let text = '';
  try {
    const data = await pdfParse(buf);
    text = (data && data.text) ? data.text : '';
  } catch (_) {}
  const compact = (text||'').replace(/\s+/g,'');
  if (compact.length >= 500) return text;

  // Fallback: pdftotext -layout
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
    const pdfPath = path.join(tmp, 'in.pdf');
    const outPath = path.join(tmp, 'out.txt');
    fs.writeFileSync(pdfPath, buf);
    execSync(`pdftotext -layout "${pdfPath}" "${outPath}"`);
    const t = fs.readFileSync(outPath, 'utf8');
    if (t && t.replace(/\s+/g,'').length > compact.length) return t;
  } catch (_) {}
  return text || '';
};
