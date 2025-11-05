const fs = require('fs');
const path = 'index.js';
let src = fs.readFileSync(path, 'utf8');

// drop any previous tagged block (safety if we rerun)
src = src.replace(/\/\/\s*=== BEGIN: process-invoices-csv[\s\S]*?=== END: process-invoices-csv\s*/gm, '');

// Replace the existing /process-invoices-csv handler (if any) with a fully-featured one.
// We support both '/process-invoices-csv' and '/api/process-invoices-csv' paths.
const block = `
// === BEGIN: process-invoices-csv ===
const { parse: csvParseSync } = require('csv-parse/sync');

function _normHeader(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s\-_]+/g, '');
}
function _pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
}
function _toNumber(v) {
  if (v == null) return undefined;
  const s = String(v).replace(/[,\\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

app.post(['/process-invoices-csv','/api/process-invoices-csv'], async (req, res) => {
  try {
    const { venueId, orderId, storagePath } = req.body || {};
    if (!venueId || !orderId || !storagePath) {
      return res.status(400).json({ ok:false, error:"missing venueId/orderId/storagePath" });
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buf] = await file.download({ validation: false });
    const text = buf.toString('utf8');

    // Parse CSV (with header). Be tolerant of ragged rows & stray BOM.
    const rows = csvParseSync(text, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });

    if (!rows.length) {
      return res.json({ ok:true, invoice:{ source:'csv', storagePath }, lines:[], matchReport:null, confidence:0.2, warnings:['CSV contained no data rows.'] });
    }

    // Build header map: normalized header -> original key
    const first = rows[0];
    const headerMap = {};
    Object.keys(first).forEach(k => {
      headerMap[_normHeader(k)] = k;
    });

    // Candidate header groups
    const H = (want) => headerMap[want];
    const codeKey = H('code') || H('sku') || H('productcode') || H('itemcode');
    const nameKey = H('name') || H('description') || H('item') || H('product');
    const qtyKey  = H('qty') || H('quantity') || H('receivedqty') || H('units') || H('received');
    const unitKey = H('unitprice') || H('price') || H('costprice') || H('cost') || H('unitcost');

    const warnings = [];
    const missing = [];
    if (!nameKey && !codeKey) missing.push('name/code');
    if (!qtyKey) missing.push('qty');
    if (!unitKey) warnings.push('No unit price column detected; unitPrice set to 0 by default.');

    if (missing.length) {
      return res.json({
        ok:true,
        invoice:{ source:'csv', storagePath },
        lines:[],
        matchReport:{ warnings:[\`Missing required columns: \${missing.join(', ')}\`] },
        confidence:0.2,
        warnings:[\`Missing required columns: \${missing.join(', ')}\`]
      });
    }

    const lines = [];
    for (const r of rows) {
      const code = codeKey ? String(r[codeKey] ?? '').trim() : undefined;
      const name = nameKey ? String(r[nameKey] ?? '').trim() : (code || '');
      const qty  = _toNumber(qtyKey ? r[qtyKey] : undefined) ?? 0;
      const unit = _toNumber(unitKey ? r[unitKey] : undefined) ?? 0;

      // Skip fully empty lines
      if (!name && !code && qty === 0 && unit === 0) continue;

      lines.push({
        code: code || undefined,
        name: name || '(item)',
        qty,
        unitPrice: unit
      });
    }

    // Confidence heuristic: headers + nonzero lines
    const headerScore =
      (nameKey ? 0.35 : 0) +
      (qtyKey ? 0.35 : 0) +
      (unitKey ? 0.20 : 0) +
      (codeKey ? 0.10 : 0);
    const volumeScore = Math.min(lines.length / 50, 0.25); // cap contribution
    const confidence = Math.max(0.4, Math.min(0.95, headerScore + volumeScore));

    return res.json({
      ok:true,
      invoice: { source:'csv', storagePath },
      lines,
      matchReport: { warnings: warnings.length ? warnings : undefined },
      confidence,
      warnings
    });
  } catch (e) {
    console.error('[process-invoices-csv] error', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});
// === END: process-invoices-csv
`;

if (/app\.post\(\s*["']\/api\/process-invoices-csv["']/.test(src) || /app\.post\(\s*\[\s*["']\/process-invoices-csv["']/.test(src)) {
  // Replace any existing handler block starting at app.post(...process-invoices-csv...) through its closing });
  src = src.replace(/app\.post\(\s*(?:\[[^\]]*\]|["']\/api\/process-invoices-csv["']|["']\/process-invoices-csv["'])[\s\S]*?\)\s*;\s*/m, block);
} else {
  // Append block near the upload-file handler (after it)
  src = src.replace(/app\.post\(\s*\[\s*['"]\/upload-file['"],\s*['"]\/api\/upload-file['"]\s*\][\s\S]*?\)\s*;\s*/m, (m) => m + '\n' + block);
}

fs.writeFileSync(path, src, 'utf8');
console.log('[patchProcessInvoicesCsv] Patched /process-invoices-csv to full parser.');
