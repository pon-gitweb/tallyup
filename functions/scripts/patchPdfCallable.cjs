const fs = require('fs');
const path = 'index.js';
let src = fs.readFileSync(path, 'utf8');

// Ensure admin init exists (we don't change it)
if (!/firebase-admin/.test(src)) {
  console.error('[patchPdfCallable] Did not find firebase-admin import; aborting.');
  process.exit(1);
}

// 1) Remove ANY existing pdf-parse imports
src = src
  .replace(/^\s*const\s+\{\s*default\s*:\s*pdfParse\s*\}\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParse\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '')
  .replace(/^\s*const\s+pdfParseModule\s*=\s*require\(['"]pdf-parse['"]\);\s*$/gm, '');

// 2) Build robust import + sanity log + callable
const block = `
// === BEGIN: pdf parser (robust import) + callable ===
const pdfParseModule = require('pdf-parse');
const pdfParse =
  typeof pdfParseModule === 'function'
    ? pdfParseModule
    : (pdfParseModule?.default || pdfParseModule?.pdfParse || pdfParseModule);

if (!pdfParse) {
  console.error('[processInvoicesPdf] pdf-parse resolved to', typeof pdfParseModule, '->', typeof pdfParse);
}

exports.processInvoicesPdf = functions.region('us-central1').https.onCall(async (data, context) => {
  try {
    const venueId = String(data?.venueId || '');
    const orderId = String(data?.orderId || '');
    const storagePath = String(data?.storagePath || '');
    if (!venueId || !orderId || !storagePath) throw new Error('venueId, orderId, storagePath are required');

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buf] = await file.download({ validation: false });
    if (!buf || !buf.length) throw new Error('Empty PDF buffer');

    // Sanity log one-time per instance
    console.log('[processInvoicesPdf] typeof pdfParse =', typeof pdfParse, 'buffer bytes =', buf.length);

    const parsed = await pdfParse(buf).catch(err => {
      throw new Error('PDF parse failed: ' + (err?.message || err));
    });
    const text = String(parsed?.text || '');

    const poMatch = text.match(/\\b(P(?:urchase)?\\.?\\s*O(?:rder)?)\\s*(?:No\\.?|#|:)?\\s*([A-Za-z0-9\\-\\/]+)\\b/i);
    const poNumber = poMatch ? poMatch[2] : null;

    return {
      invoice: { source: 'pdf', storagePath, poNumber },
      lines: [],                 // TODO: supplier profiles
      matchReport: null,
      confidence: poNumber ? 0.6 : 0.5,
      warnings: poNumber ? [] : ['PO number not detected in PDF (heuristic).'],
    };
  } catch (e) {
    console.error('[processInvoicesPdf] error', e);
    throw new functions.https.HttpsError('unknown', String(e?.message || e));
  }
});
// === END: pdf parser (robust import) + callable ===
`;

// 3) Replace existing callable block if present, else append near the end
if (/exports\.processInvoicesPdf\s*=/.test(src)) {
  src = src.replace(/\/\/\s*=== BEGIN:[\s\S]*?=== END:[\s\S]*?===\s*/gm, ''); // drop any previous tagged block
  src = src.replace(/exports\.processInvoicesPdf\s*=\s*functions[\s\S]*?;\s*\n/gm, '');
  src = src.trimEnd() + '\n' + block;
} else {
  src = src.trimEnd() + '\n' + block;
}

fs.writeFileSync(path, src, 'utf8');
console.log('[patchPdfCallable] Patched processInvoicesPdf with robust import.');
