/**
 * Stable Cloud Functions entry.
 * - Express REST under exports.api (region us-central1)
 * - Callable: processInvoicesPdf (region us-central1)
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
// Callable: processInvoicesPdf (robust pdf-parse import)
// ----------------------------------------------------------------------------
const pdfParseModule = require('pdf-parse');
const pdfParse =
  (typeof pdfParseModule === 'function')
    ? pdfParseModule
    : (pdfParseModule && (pdfParseModule.default || pdfParseModule.pdfParse || null));

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

    return {
      invoice: { source: 'pdf', storagePath, poNumber },
      lines: [],
      matchReport: null,
      confidence: poNumber ? 0.6 : 0.5,
      warnings: poNumber ? [] : ['PO number not detected in PDF (heuristic).'],
    };
  } catch (e) {
    console.error('[processInvoicesPdf] error', e);
    throw new functions.https.HttpsError('unknown', String(e?.message || e));
  }
});

// ----------------------------------------------------------------------------
exports.api = functions.region('us-central1').https.onRequest(app);
