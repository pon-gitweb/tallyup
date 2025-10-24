const fs = require('node:fs');
const path = require('node:path');

const pdfParseMod = require('pdf-parse');

// Normalise into an object with a .parse(buffer) method
const parser =
  (typeof pdfParseMod === 'function' && { parse: pdfParseMod }) ||
  (pdfParseMod && typeof pdfParseMod.default === 'function' && { parse: pdfParseMod.default }) ||
  (pdfParseMod && typeof pdfParseMod.PDFParse === 'function' && new pdfParseMod.PDFParse());

if (!parser || typeof parser.parse !== 'function') {
  console.error('pdf-parse export keys:', Object.keys(pdfParseMod || {}));
  throw new Error('Could not get a parser.parse(buffer) function from pdf-parse.');
}

const { csvHeaders, toRow, ensureSupplierSlug } = require('./utils.cjs');

const extractTicketyBoo = require('./extractors/ticketyboo.cjs');
const extractPLC        = require('./extractors/plc.cjs');
const extractNo8        = require('./extractors/no8.cjs');
const extractAlchemy    = require('./extractors/alchemy.cjs');
const extractNicely     = require('./extractors/nicelydone.cjs');
const extractMasterFMC  = require('./extractors/masterfmc.cjs');

const ROOT   = process.cwd();
const IN_DIR = path.join(ROOT, 'catalog_pdfs');
const OUT_DIR= path.join(ROOT, 'supplier_catalogs/normalized');

const SUPPLIER_RULES = [
  { id:'ticketyboo', match: /tickety[\s-]?boo|t[io]ckety/i,      extractor: extractTicketyBoo, label:'Tickety Boo' },
  { id:'plc',        match: /premium liquor|plc-20|PLC-20/i,     extractor: extractPLC,       label:'Premium Liquor' },
  { id:'no8',        match: /no\.?8|no8\s+distillery/i,          extractor: extractNo8,       label:'No.8 Distillery' },
  { id:'alchemy',    match: /alchemy.*tonic|160ml/i,             extractor: extractAlchemy,   label:'Alchemy Tonic' },
  { id:'nicely',     match: /nicely\s+done/i,                    extractor: extractNicely,    label:'Nicely Done' },
  { id:'masterfmc',  match: /master\s+fm&co|fm&co/i,             extractor: extractMasterFMC, label:'MASTER FM&Co' },
];

const chooseExtractor = (text, filename) => {
  for (const r of SUPPLIER_RULES) {
    if (r.match.test(filename) || r.match.test((text||'').slice(0, 4000))) return r;
  }
  return SUPPLIER_RULES[0];
};

(async function main() {
  if (!fs.existsSync(IN_DIR)) { console.error(`Missing input folder: ${IN_DIR}`); process.exit(1); }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive:true });

  const files = fs.readdirSync(IN_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (!files.length) { console.log('No PDFs found in catalog_pdfs/.'); process.exit(0); }

  for (const file of files) {
    const buf = fs.readFileSync(path.join(IN_DIR, file));
    const data = await parser.parse(buf);
    const text = data && data.text ? data.text : '';
    const rule = chooseExtractor(text, file);
    const rows = rule.extractor({ text, supplier: rule.label });
    const slug = ensureSupplierSlug(rule.label);
    const outPath = path.join(OUT_DIR, `${slug}.csv`);
    const header = csvHeaders.join(',');
    const body = rows.map(toRow).join('\n');
    fs.writeFileSync(outPath, `${header}\n${body}\n`, 'utf8');
    const density = text.replace(/\s+/g,'').length;
    console.log(`[catalog] ${rule.label} (${file}) → ${rows.length} rows (${density ? 'text ok' : 'no text - likely scanned/OCR needed'}) → ${outPath}`);
  }
})().catch(err => { console.error(err); process.exit(1); });
