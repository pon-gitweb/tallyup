// @ts-nocheck
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Ensure Admin is initialised (index.ts also does this but it's safe to repeat)
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Very simple "name qty x price" style extractor.
// This mirrors the lightweight extractor from your older invoice PDF backup.
function extractSalesLines(text: string) {
  const lines: Array<{ name: string; qty: number; unitPrice: number }> = [];
  const warnings: string[] = [];

  const rows = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter(Boolean);

  for (const row of rows) {
    const s = row.trim();
    if (!s) continue;

    // e.g. "Heineken 330ml 24pk   12 x 35.00"
    const m = s.match(/(.+?)\s+(\d+(?:\.\d+)?)\s+[xX*]\s*\$?(\d+(?:\.\d+)?)/);
    if (!m) continue;

    const name = m[1].trim();
    const qty = Number(m[2]);
    const unitPrice = Number(m[3]);

    if (name && Number.isFinite(qty) && Number.isFinite(unitPrice)) {
      lines.push({ name, qty, unitPrice });
    }
  }

  if (!lines.length) {
    warnings.push(
      'No obvious line items detected in PDF. Try a CSV export from your POS if available.'
    );
  }

  return { lines, warnings };
}

const pdfParseModule = require('pdf-parse');
const pdfParse =
  typeof pdfParseModule === 'function'
    ? pdfParseModule
    : (pdfParseModule &&
        (pdfParseModule.default || pdfParseModule.pdfParse || null));

export const processSalesPdf = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.set('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      const body = (req.body || {}) as {
        venueId?: string;
        filename?: string;
        data?: string;
      };

      const { venueId, filename, data } = body || {};

      if (!venueId) {
        return res.status(400).json({ ok: false, error: 'venueId required' });
      }
      if (!data) {
        return res.status(400).json({ ok: false, error: 'data (base64) required' });
      }

      const m = String(data).match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        return res.status(400).json({
          ok: false,
          error: 'Expected data URL with base64-encoded PDF (data:application/pdf;base64,...)',
        });
      }

      const contentType = m[1];
      const base64 = m[2];

      if (!/pdf/i.test(contentType)) {
        console.warn('[processSalesPdf] non-PDF contentType', contentType);
      }

      const buffer = Buffer.from(base64, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ ok: false, error: 'Empty PDF buffer' });
      }

      if (!pdfParse) {
        console.error('[processSalesPdf] pdf-parse did not resolve to a function');
        return res
          .status(500)
          .json({ ok: false, error: 'pdf-parse module not available on server' });
      }

      const parsed = await pdfParse(buffer).catch((err: any) => {
        throw new Error('PDF parse failed: ' + (err?.message || String(err)));
      });

      const text = String((parsed as any)?.text || '');
      const { lines, warnings } = extractSalesLines(text);

      const normalizedLines = (lines || []).map((l) => {
        const qty = Number(l.qty || 0);
        const unit = Number(l.unitPrice || 0);
        const net = qty * unit;
        return {
          sku: null,
          barcode: null,
          name: l.name,
          qtySold: qty,
          gross: net,
          net,
          tax: null,
        };
      });

      const report = {
        source: 'pdf' as const,
        period: {
          start: null,
          end: null,
        },
        lines: normalizedLines,
        warnings: warnings || [],
        filename: filename || null,
      };

      return res.json({ ok: true, report });
    } catch (e: any) {
      console.error('[processSalesPdf] error', e);
      return res
        .status(500)
        .json({ ok: false, error: String(e?.message || e) });
    }
  });
