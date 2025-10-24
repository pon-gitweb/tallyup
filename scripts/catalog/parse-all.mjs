import fs from 'node:fs';
import path from 'node:path';

async function loadPdfParse() {
  // Try native ESM import first (CJS modules appear on .default in Node ESM)
  try {
    const mod = await import('pdf-parse');
    const cand = mod?.default ?? mod?.pdf ?? mod;
    if (typeof cand === 'function') return cand;
  } catch (_) {}
  // Fallback to require()
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const mod = require('pdf-parse');
  const cand = mod?.default ?? mod?.pdf ?? mod;
  if (typeof cand === 'function') return cand;
  throw new Error('Unable to load pdf-parse as a function');
}

const pdfParse = await loadPdfParse();

import { csvHeaders, toRow, ensureSupplierSlug } from './utils.mjs';

import extractTicketyBoo from './extractors/ticketyboo.mjs';
import extractPLC       from './extractors/plc.mjs';
import extractNo8       from './extractors/no8.mjs';
import extractAlchemy   from './extractors/alchemy.mjs';
import extractNicely    from './extractors/nicelydone.mjs';
import extractMasterFMC from './extractors/masterfmc.mjs';

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

const main = async () => {
  if (!fs.existsSync(IN_DIR)) { console.error(`Missing input folder: ${IN_DIR}`); process.exit(1); }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive:true });

  const files = fs.readdirSync(IN_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (!files.length) { console.log('No PDFs found in catalog_pdfs/.'); process.exit(0); }

  for (const file of files) {
    const buf = fs.readFileSync(path.join(IN_DIR, file));
    const data = await pdfParse(buf);
    const text = data?.text || '';
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
};

main().catch(err => { console.error(err); process.exit(1); });
