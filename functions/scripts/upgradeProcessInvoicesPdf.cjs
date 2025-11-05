const fs = require('fs');
const p = 'index.js';
let s = fs.readFileSync(p, 'utf8');

// helper to inject/replace the callable cleanly
function replaceProcessInvoicesPdf(src) {
  const newBlock = `
// ===== BEGIN: processInvoicesPdf (with line extraction) =====
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
  // codes like ABC123, 012345, L-001-22, 1234-567 etc.
  return /^[A-Za-z0-9][A-Za-z0-9\-./]{2,16}$/.test(s);
}
function _isQty(tok) {
  const n = _normNum(tok);
  if (n == null) return false;
  // qty tends to be an integer or simple decimal and not > 9999
  return n >= 0 && n <= 9999;
}
function _isPrice(tok) {
  const s = String(tok || '').trim();
  if (!s) return false;
  // $12.34, 12.34, 1,234.56, ex GST markers etc.
  return /\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?$/.test(s);
}
function _splitColumns(line) {
  // Many PDFs keep columns separated by >=2 spaces. Fall back to 1+ spaces if needed.
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
    .map(l => l.replace(/\u00A0/g, ' ').trim())   // normalize NBSP
    .filter(Boolean);

  // Try to find a header row that hints at columns (qty/name/price)
  let headerIdx = -1;
  const headerNeedles = ['qty','quantity','description','item','product','unit price','price','unit cost','total'];
  for (let i = 0; i < Math.min(raw.length, 80); i++) {
    const l = raw[i].toLowerCase();
    const hit = headerNeedles.some(h => l.includes(h));
    if (hit) { headerIdx = i; break; }
  }

  // We’ll parse from a little after header if found; else from start.
  const start = headerIdx >= 0 ? Math.max(0, headerIdx + 1) : 0;

  for (let i = start; i < raw.length; i++) {
    const l = raw[i];

    // Skip obvious non-line rows
    if (/^subtotal\b|^total\b|^gst\b|^vat\b|^invoice\b|^page\b/i.test(l)) continue;

    const cols = _splitColumns(l);

    // Heuristic 1: If we have 3-6 columns, there’s a chance we have [code?] [name ...] [qty] [unit] [total?]
    if (cols.length >= 3 && cols.length <= 7) {
      const qtyIdx = cols.findIndex(_isQty);
      // Prefer a price token near the end
      let unitIdx = -1;
      for (let c = cols.length - 1; c >= 0; c--) {
        if (_isPrice(cols[c])) { unitIdx = c; break; }
      }

      // If we have qty and a price-ish number, treat the rest (start..before qty/unit) as description
      if (qtyIdx !== -1 && unitIdx !== -1 && unitIdx !== qtyIdx) {
        // Name region is everything between start and min(qtyIdx, unitIdx), but often the name is the longest token.
        const nameRegion = cols.slice(0, Math.min(qtyIdx, unitIdx) + 1);
        // Try to peel off a leading code if present
        let code;
        if (nameRegion.length >= 1 && _likelyCode(nameRegion[0])) {
          code = nameRegion.shift();
        }
        const name = nameRegion.join(' ').trim();

        const qty = _normNum(cols[qtyIdx]);
        // Prefer a smaller price near the end as unit price; if we only see one price, use it as unit
        const unitPrice = _normNum(cols[unitIdx]);

        if (name && qty != null) {
          lines.push({
            code: code || undefined,
            name,
            qty,
            unitPrice: unitPrice ?? 0
          });
          continue;
        }
      }
    }

    // Heuristic 2: “CODE  NAME …  x QTY @ UNITPRICE”
    const m2 = l.match(/^(?:\s*(?<code>[A-Za-z0-9][A-Za-z0-9\-./]{2,16})\s+)?(?<name>.+?)\s+(?<qty>\d+(?:\.\d+)?)\s*@\s*(?<unit>\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?)\s*$/);
    if (m2 && m2.groups) {
      const { code, name, qty, unit } = m2.groups;
      const nQty = _normNum(qty);
      const nUnit = _normNum(unit);
      if (name && nQty != null) {
        lines.push({
          code: code || undefined,
          name: name.trim(),
          qty: nQty,
          unitPrice: nUnit ?? 0
        });
        continue;
      }
    }

    // Heuristic 3: fall-through — do nothing for this line
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

    // Pull a PO number (very light heuristic)
    const poMatch = text.match(/\\b(P(?:urchase)?\\.?\\s*O(?:rder)?)\\s*(?:No\\.?|#|:)?\\s*([A-Za-z0-9\\-\\/]+)\\b/i);
    const poNumber = poMatch ? poMatch[2] : null;

    // Extract line items
    const { lines, warnings } = extractPdfLines(text);

    // Confidence heuristic: if we got >= 3 lines w/ qty and (some) price -> higher
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
// ===== END: processInvoicesPdf (with line extraction) =====
`;

  // remove any existing callable impl first
  let out = src
    .replace(/\/\/\s*===== BEGIN: processInvoicesPdf[\s\S]*?===== END: processInvoicesPdf[\s\S]*?\n/gm, '')
    .replace(/exports\.processInvoicesPdf\s*=\s*functions[\s\S]*?\);\s*/gm, '');

  // append the new block at the end (just before exports.api if present)
  const apiHook = out.match(/^\s*exports\.api\s*=\s*functions[^\n]*$/m);
  if (apiHook) {
    const idx = apiHook.index;
    out = out.slice(0, idx) + newBlock + '\n' + out.slice(idx);
  } else {
    out = out.trimEnd() + '\n' + newBlock + '\n';
  }
  return out;
}

s = replaceProcessInvoicesPdf(s);
fs.writeFileSync(p, s, 'utf8');
console.log('[upgradeProcessInvoicesPdf] Replaced callable with line extraction version.');
