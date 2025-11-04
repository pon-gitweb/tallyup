/**
 * Stable Cloud Functions entry.
 * - Express REST under exports.api (region us-central1)
 * - Callable: processInvoicesPdf (region us-central1) with basic line extraction
 */
const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { parse: csvParseSync } = require('csv-parse/sync');

try { admin.app(); } catch { admin.initializeApp(); }

// ----------------------------------------------------------------------------
// Express app (REST)
// ----------------------------------------------------------------------------
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '15mb' })); // allow base64 payloads

// ---------------------- Entitlement (kept) ----------------------
app.get('/api/entitlement', (req, res) => {
  res.setHeader('x-ai-remaining', '99');
  res.setHeader('x-ai-retry-after', '0');
  return res.json({ ok: true, entitled: true });
});
app.post('/api/entitlement/dev-grant', (req, res) => {
  res.setHeader('x-ai-remaining', '99');
  res.setHeader('x-ai-retry-after', '0');
  return res.json({ ok: true, granted: true });
});
app.post('/api/validate-promo', (req, res) => {
  res.setHeader('x-ai-remaining', '99');
  res.setHeader('x-ai-retry-after', '0');
  return res.json({ ok: true, valid: true, quota: 99 });
});

// ----------------- Suggest orders passthrough (kept) ------------
app.post('/api/suggest-orders', (req, res) => {
  try {
    const body = req.body || {};
    const { venueId, baseline } = body;
    if (!venueId || !baseline) return res.status(400).json({ error: 'missing venueId/baseline' });
    const aiRemaining = Number.isFinite(Number(req.headers['x-ai-remaining'])) ? Number(req.headers['x-ai-remaining']) : 99;
    res.setHeader('x-ai-remaining', String(aiRemaining));
    res.setHeader('x-ai-retry-after', '0');
    return res.json({
      buckets: baseline.buckets || {},
      unassigned: baseline.unassigned || { lines: [] },
      meta: { rationale: 'overlay_passthrough', factors: ['Server reachable','LLM not yet applied'], aiRemaining, retryAfterSeconds: 0 }
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------------------- Upload CSV/PDF to GCS -------------------
app.post(['/upload-file','/api/upload-file'], async (req, res) => {
  try {
    const { destPath, dataUrl, cacheControl } = req.body || {};
    if (!destPath || !dataUrl) {
      return res.status(400).json({ ok: false, error: 'destPath and dataUrl required' });
    }
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok:false, error:'Invalid dataUrl' });

    const contentType = m[1];
    const base64 = m[2];
    const buffer = Buffer.from(base64, 'base64');

    const bucket = admin.storage().bucket();
    const file = bucket.file(destPath);

    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: { contentType, cacheControl: cacheControl || 'public,max-age=3600' },
    });

    return res.json({ ok: true, fullPath: destPath });
  } catch (e) {
    console.error('[upload-file] error', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.post('/api/process-invoices-pdf', async (req, res) => {
  try {
    const { venueId, orderId, storagePath } = req.body || {};
    if (!venueId || !orderId || !storagePath) {
      return res.status(400).json({ ok:false, error:"missing venueId/orderId/storagePath" });
    }

    const pdfParseModule = require('pdf-parse');
    const pdfParse =
      (typeof pdfParseModule === 'function')
        ? pdfParseModule
        : (pdfParseModule && (pdfParseModule.default || pdfParseModule.pdfParse || null));
    if (!pdfParse) return res.status(500).json({ ok:false, error: 'pdf-parse module did not resolve to a function' });

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buf] = await file.download({ validation: false });
    if (!buf || !buf.length) return res.status(400).json({ ok:false, error: 'Empty PDF buffer' });

    const parsed = await pdfParse(buf).catch(err => {
      throw new Error('PDF parse failed: ' + (err?.message || err));
    });
    const text = String(parsed?.text || '');

    const poMatch = text.match(/\b(P(?:urchase)?\.?\s*O(?:rder)?)\s*(?:No\.?|#|:)?\s*([A-Za-z0-9\-\/]+)\b/i);
    const poNumber = poMatch ? poMatch[2] : null;

    const { lines, warnings } = extractPdfLines(text);
    const confidence =
      (lines.length >= 3 && lines.some(x => x.unitPrice && x.unitPrice > 0)) ? 0.8
      : (lines.length >= 1 ? 0.6 : 0.4);

    return res.json({
      ok:true,
      invoice: { source: 'pdf', storagePath, poNumber },
      lines,
      matchReport: { warnings: warnings.length ? warnings : undefined },
      confidence,
      warnings
    });
  } catch (e) {
    console.error('[api/process-invoices-pdf] error', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});



// --------------------- Process Invoices CSV ---------------------
function _normHeader(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s\-_]+/g, '');
}
function _toNumber(v) {
  if (v == null) return undefined;
  const s = String(v).replace(/[,\s]/g, '');
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
    Object.keys(first).forEach(k => { headerMap[_normHeader(k)] = k; });

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
        matchReport:{ warnings:[`Missing required columns: ${missing.join(', ')}`] },
        confidence:0.2,
        warnings:[`Missing required columns: ${missing.join(', ')}`]
      });
    }

    const lines = [];
    for (const r of rows) {
      const code = codeKey ? String(r[codeKey] ?? '').trim() : undefined;
      const name = nameKey ? String(r[nameKey] ?? '').trim() : (code || '');
      const qty  = _toNumber(qtyKey ? r[qtyKey] : undefined) ?? 0;
      const unit = _toNumber(unitKey ? r[unitKey] : undefined) ?? 0;
      if (!name && !code && qty === 0 && unit === 0) continue;
      lines.push({ code: code || undefined, name: name || '(item)', qty, unitPrice: unit });
    }

    const headerScore =
      (nameKey ? 0.35 : 0) +
      (qtyKey ? 0.35 : 0) +
      (unitKey ? 0.20 : 0) +
      (codeKey ? 0.10 : 0);
    const volumeScore = Math.min(lines.length / 50, 0.25);
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

// ----------------------------------------------------------------------------
// Callable: processInvoicesPdf (robust pdf-parse import + basic line extraction)
// ----------------------------------------------------------------------------
const pdfParseModule = require('pdf-parse');
const pdfParse =
  (typeof pdfParseModule === 'function')
    ? pdfParseModule
    : (pdfParseModule && (pdfParseModule.default || pdfParseModule.pdfParse || null));

function _normNum(v) {
  if (v == null) return undefined;
  const s = String(v).replace(/[,$\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function _likelyCode(tok) {
  const s = String(tok || '').trim();
  if (!s) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\-./]{2,16}$/.test(s);
}
function _isQty(tok) {
  const n = _normNum(tok);
  if (n == null) return false;
  return n >= 0 && n <= 9999;
}
function _isPrice(tok) {
  const s = String(tok || '').trim();
  if (!s) return false;
  return /\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?$/.test(s);
}
function _splitColumns(line) {
  const by2 = line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
  if (by2.length >= 2) return by2;
  return line.split(/\s+/).map(t => t.trim()).filter(Boolean);
}
function extractPdfLines(text) {
  const lines = [];
  const warnings = [];

  const raw = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/\u00A0/g, ' ').trim())
    .filter(Boolean);

  // --- Path 1: CSV-like header + rows inside PDF text ---
  // Look for a header with commas containing something like SKU,Name,Qty,UnitPrice
  let csvHeaderIdx = -1;
  let csvHeaderCols = null;
  for (let i = 0; i < Math.min(raw.length, 80); i++) {
    const l = raw[i];
    if (l.includes(',')) {
      const cols = l.split(',').map(t => t.trim());
      const norm = cols.map(c => c.toLowerCase().replace(/[\s_\-]+/g,''));
      // must include a name/desc, qty, and possibly price
      const hasName = norm.some(x => ['name','description','item','product'].includes(x));
      const hasQty  = norm.some(x => ['qty','quantity','receivedqty','units','received'].includes(x));
      const hasPrice= norm.some(x => ['unitprice','price','costprice','cost','unitcost','exprice','exgst','netprice'].includes(x));
      if (hasName && hasQty) {
        csvHeaderIdx = i;
        csvHeaderCols = { cols, norm };
        break;
      }
    }
  }
  if (csvHeaderIdx >= 0 && csvHeaderCols) {
    const idxOf = (aliases) => csvHeaderCols.norm.findIndex(x => aliases.includes(x));
    const codeIdx = idxOf(['code','sku','productcode','itemcode']);
    const nameIdx = idxOf(['name','description','item','product','desc']);
    const qtyIdx  = idxOf(['qty','quantity','receivedqty','units','received']);
    const unitIdx = idxOf(['unitprice','price','costprice','cost','unitcost','exprice','exgst','netprice']);

    for (let i = csvHeaderIdx + 1; i < raw.length; i++) {
      const l = raw[i];
      if (!l.includes(',')) break; // stop at end of csv block
      const cols = l.split(',').map(t => t.trim());
      if (cols.length < 2) continue;

      const get = (idx) => (idx >= 0 && idx < cols.length ? cols[idx] : undefined);
      const name = get(nameIdx) || get(codeIdx) || '';
      const qty = (() => {
        const v = get(qtyIdx);
        if (v == null) return 0;
        const n = Number(String(v).replace(/[\s,]/g,''));
        return Number.isFinite(n) ? n : 0;
      })();
      const unitPrice = (() => {
        const v = get(unitIdx);
        if (v == null || v === '') return undefined;
        const n = Number(String(v).replace(/[$\s,]/g,''));
        return Number.isFinite(n) ? n : undefined;
      })();
      if (!name && !get(codeIdx) && qty === 0 && (unitPrice == null)) continue;
      lines.push({
        code: get(codeIdx) || undefined,
        name: name || '(item)',
        qty,
        unitPrice
      });
    }
  }

  // If CSV path found few or no lines, fall back to column/price heuristics.
  if (lines.length < 1) {
    // Helpers from the outer scope
    const by2 = (line) => line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
    const splitCols = (line) => {
      const two = by2(line);
      if (two.length >= 2) return two;
      return line.split(/\s+/).map(t => t.trim()).filter(Boolean);
    };
    for (let i = 0; i < raw.length; i++) {
      const l = raw[i];
      if (/^subtotal\b|^total\b|^gst\b|^vat\b|^invoice\b|^page\b/i.test(l)) continue;
      const cols = splitCols(l);

      if (cols.length >= 3 && cols.length <= 7) {
        const qtyIdx = cols.findIndex(_isQty);
        let unitIdx = -1;
        for (let c = cols.length - 1; c >= 0; c--) {
          if (_isPrice(cols[c])) { unitIdx = c; break; }
        }
        if (qtyIdx !== -1 && unitIdx !== -1 && unitIdx !== qtyIdx) {
          const nameRegion = cols.slice(0, Math.min(qtyIdx, unitIdx) + 1);
          let code;
          if (nameRegion.length >= 1 && _likelyCode(nameRegion[0])) code = nameRegion.shift();
          const name = nameRegion.join(' ').trim();
          const qty = _normNum(cols[qtyIdx]);
          const unitPrice = _normNum(cols[unitIdx]);
          if (name && qty != null) {
            lines.push({ code: code || undefined, name, qty, unitPrice: unitPrice ?? 0 });
            continue;
          }
        }
      }
      const m2 = l.match(/^(?:\s*(?<code>[A-Za-z0-9][A-Za-z0-9\-./]{2,16})\s+)?(?<name>.+?)\s+(?<qty>\d+(?:\.\d+)?)\s*@\s*(?<unit>\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*$/);
      if (m2 && m2.groups) {
        const { code, name, qty, unit } = m2.groups;
        const nQty = _normNum(qty);
        const nUnit = _normNum(unit);
        if (name && nQty != null) {
          lines.push({ code: code || undefined, name: name.trim(), qty: nQty, unitPrice: nUnit ?? 0 });
          continue;
        }
      }
    }
  }

  if (!lines.length) {
    warnings.push('No item lines detected from PDF text (layout may be image-based or atypical).');
  }
  return { lines, warnings };
}


exports.processInvoicesPdf = functions.region('us-central1').https.onCall(async (data, context) => {
  try {
    const venueId = String(data?.venueId || '');
    const orderId = String(data?.orderId || '');
    const storagePath = String(data?.storagePath || '');
    if (!venueId || !orderId || !storagePath) {
      throw new Error('venueId, orderId, storagePath are required');
    }
    if (!pdfParse) throw new Error('pdf-parse module did not resolve to a function');

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buf] = await file.download({ validation: false });
    if (!buf || !buf.length) throw new Error('Empty PDF buffer');

    const parsed = await pdfParse(buf).catch(err => {
      throw new Error('PDF parse failed: ' + (err?.message || err));
    });
    const text = String(parsed?.text || '');

    const poMatch = text.match(/\b(P(?:urchase)?\.?\s*O(?:rder)?)\s*(?:No\.?|#|:)?\s*([A-Za-z0-9\-\/]+)\b/i);
    const poNumber = poMatch ? poMatch[2] : null;

    const { lines, warnings } = extractPdfLines(text);

    const confidence =
      lines.length >= 3 && lines.some(x => x.unitPrice && x.unitPrice > 0)
        ? 0.8
        : (lines.length >= 1 ? 0.6 : 0.4);

    return {
      invoice: { source: 'pdf', storagePath, poNumber },
      lines,
      matchReport: { warnings: warnings.length ? warnings : undefined },
      confidence,
      warnings
    };
  } catch (e) {
    console.error('[processInvoicesPdf] error', e);
    throw new functions.https.HttpsError('unknown', String(e?.message || e));
  }
});

// ----------------------------------------------------------------------------
exports.api = functions.region('us-central1').https.onRequest(app);

// --------------------- Process Invoices PDF (REST) ---------------------
app.post(['/process-invoices-pdf','/api/process-invoices-pdf'], async (req, res) => {
  try {
    const { venueId, orderId, storagePath } = req.body || {};
    if (!venueId || !orderId || !storagePath) {
      return res.status(400).json({ ok:false, error:'missing venueId/orderId/storagePath' });
    }

    // Require in-scope to avoid top-level duplication/const conflicts
    const pdfParseModule = require('pdf-parse');
    const pdfParse =
      typeof pdfParseModule === 'function'
        ? pdfParseModule
        : (pdfParseModule && (pdfParseModule.default || pdfParseModule.pdfParse || null));

    if (!pdfParse) {
      return res.status(500).json({ ok:false, error:'pdf-parse module did not resolve to a function' });
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [buf] = await file.download({ validation: false });
    if (!buf || !buf.length) {
      return res.status(400).json({ ok:false, error:'Empty PDF buffer' });
    }

    const parsed = await pdfParse(buf).catch(err => {
      throw new Error('PDF parse failed: ' + (err?.message || err));
    });
    const text = String(parsed?.text || '');

    // Helpers duplicated locally to avoid cross-scope issues
    const _normNum = (v) => {
      if (v == null) return undefined;
      const s = String(v).replace(/[,$\s]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const _likelyCode = (tok) => /^[A-Za-z0-9][A-Za-z0-9\-./]{2,16}$/.test(String(tok || '').trim());
    const _isQty = (tok) => {
      const n = _normNum(tok);
      return n != null && n >= 0 && n <= 9999;
    };
    const _isPrice = (tok) => /\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?$/.test(String(tok || '').trim());
    const _splitColumns = (line) => {
      const by2 = line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
      if (by2.length >= 2) return by2;
      return line.split(/\s+/).map(t => t.trim()).filter(Boolean);
    };

    const extractPdfLines = (txt) => {
      const lines = [];
      const warnings = [];
      const raw = String(txt || '')
        .replace(/\r/g, '')
        .split('\n')
        .map(l => l.replace(/\u00A0/g, ' ').trim())
        .filter(Boolean);

      let headerIdx = -1;
      const headerNeedles = ['qty','quantity','description','item','product','unit price','price','unit cost','total'];
      for (let i = 0; i < Math.min(raw.length, 80); i++) {
        const l = raw[i].toLowerCase();
        if (headerNeedles.some(h => l.includes(h))) { headerIdx = i; break; }
      }
      const start = headerIdx >= 0 ? Math.max(0, headerIdx + 1) : 0;

      for (let i = start; i < raw.length; i++) {
        const l = raw[i];
        if (/^subtotal\b|^total\b|^gst\b|^vat\b|^invoice\b|^page\b/i.test(l)) continue;

        const cols = _splitColumns(l);

        if (cols.length >= 3 && cols.length <= 7) {
          const qtyIdx = cols.findIndex(_isQty);
          let unitIdx = -1;
          for (let c = cols.length - 1; c >= 0; c--) {
            if (_isPrice(cols[c])) { unitIdx = c; break; }
          }
          if (qtyIdx !== -1 && unitIdx !== -1 && unitIdx !== qtyIdx) {
            const nameRegion = cols.slice(0, Math.min(qtyIdx, unitIdx) + 1);
            let code;
            if (nameRegion.length >= 1 && _likelyCode(nameRegion[0])) {
              code = nameRegion.shift();
            }
            const name = nameRegion.join(' ').trim();
            const qty = _normNum(cols[qtyIdx]);
            const unitPrice = _normNum(cols[unitIdx]);
            if (name && qty != null) {
              lines.push({ code: code || undefined, name, qty, unitPrice: unitPrice ?? 0 });
              continue;
            }
          }
        }

        const m2 = l.match(/^(?:\s*(?<code>[A-Za-z0-9][A-Za-z0-9\-./]{2,16})\s+)?(?<name>.+?)\s+(?<qty>\d+(?:\.\d+)?)\s*@\s*(?<unit>\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*$/);
        if (m2 && m2.groups) {
          const { code, name, qty, unit } = m2.groups;
          const nQty = _normNum(qty);
          const nUnit = _normNum(unit);
          if (name && nQty != null) {
            lines.push({ code: code || undefined, name: name.trim(), qty: nQty, unitPrice: nUnit ?? 0 });
            continue;
          }
        }
      }

      if (!lines.length) warnings.push('No item lines detected from PDF text (layout may be image-based or atypical).');
      return { lines, warnings };
    };

    const poMatch = text.match(/\b(P(?:urchase)?\.?\s*O(?:rder)?)\s*(?:No\.?|#|:)?\s*([A-Za-z0-9\-\/]+)\b/i);
    const poNumber = poMatch ? poMatch[2] : null;

    const { lines, warnings } = extractPdfLines(text);
    const confidence =
      lines.length >= 3 && lines.some(x => x.unitPrice && x.unitPrice > 0)
        ? 0.8
        : (lines.length >= 1 ? 0.6 : 0.4);

    return res.json({
      ok: true,
      invoice: { source: 'pdf', storagePath, poNumber },
      lines,
      matchReport: { warnings: warnings.length ? warnings : undefined },
      confidence,
      warnings
    });
  } catch (e) {
    console.error('[process-invoices-pdf REST] error', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});
