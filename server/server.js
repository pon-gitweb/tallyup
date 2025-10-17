import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import { z } from 'zod';

/** ENV */
const PORT = Number(process.env.PORT || 3001);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEV_PROMO_CODES = String(process.env.DEV_PROMO_CODES || '').split(',').map(s=>s.trim()).filter(Boolean);

if (!OPENAI_API_KEY) {
  console.warn('[AI SERVER] WARNING: OPENAI_API_KEY not set. /v1/suggest-orders will fail until you set it in .env');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/** Zod schema for AI output */
const LineSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().optional(),
  qty: z.number().int().min(1),
  unitCost: z.number().optional(),
  cost: z.number().optional(),
  packSize: z.number().nullable().optional()
});
const BucketsSchema = z.record(z.object({
  supplierName: z.string().optional(),
  lines: z.array(LineSchema)
}));
const SuggestionSchema = z.object({
  buckets: BucketsSchema,
  unassigned: z.object({ lines: z.array(LineSchema) })
});

/** Helpers */
function normalizeLine(l) {
  const qty = Number.isFinite(l?.qty) ? Math.max(1, Math.round(Number(l.qty))) : 1;
  const unitCost = Number(l?.unitCost ?? l?.cost ?? 0) || 0;
  const packSize = Number.isFinite(l?.packSize) ? Number(l.packSize) : null;
  return {
    productId: String(l?.productId || ''),
    productName: l?.productName ? String(l.productName) : (l?.name ? String(l.name) : undefined),
    qty,
    unitCost,
    cost: unitCost,
    packSize
  };
}

function normalizeAIResult(raw) {
  const out = { buckets: {}, unassigned: { lines: [] } };
  if (raw && raw.buckets && typeof raw.buckets === 'object') {
    for (const [sid, b] of Object.entries(raw.buckets)) {
      const lines = Array.isArray(b?.lines) ? b.lines.map(normalizeLine).filter(x=>x.productId) : [];
      out.buckets[String(sid)] = {
        supplierName: typeof b?.supplierName === 'string' ? b.supplierName : undefined,
        lines
      };
    }
  }
  if (Array.isArray(raw?.unassigned?.lines)) {
    out.unassigned.lines = raw.unassigned.lines.map(normalizeLine).filter(x=>x.productId);
  }
  return out;
}

/** ROUTES **/

// 1) Entitlement (DEV: always allow)
app.post('/api/entitlement', async (req, res) => {
  // In prod, check your billing DB for venueId access.
  // DEV: always allow + 90 days
  return res.json({ allowed: true, allowedHistoryDays: 90, expiresAt: null });
});

// 2) Validate promo (DEV: accept codes from env)
app.post('/api/validate-promo', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, message: 'missing_code' });
  const ok = DEV_PROMO_CODES.includes(String(code).trim());
  if (!ok) return res.json({ success: false, message: 'invalid_code' });
  return res.json({ success: true, allowedHistoryDays: 90, message: 'dev_bypass' });
});

// 3) AI Suggested Orders
app.post('/v1/suggest-orders', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }
    const { venueId, historyDays = 90, roundToPack = true, defaultParIfMissing = 6, since } = req.body || {};
    if (!venueId) return res.status(400).json({ error: 'venueId required' });

    // Build a compact prompt. In production you’d fetch aggregates here and inline them.
    const system = [
      'You are a purchasing assistant for a hospitality venue.',
      'Return a single compact JSON object with fields: { buckets: { [supplierId]: { supplierName?: string, lines: Array<{ productId, productName?, qty, unitCost?, packSize? }> } }, unassigned: { lines: Array<...> } }',
      'Do not include any extra keys. All quantities must be positive integers (min 1). If price is unknown, omit unitCost.'
    ].join(' ');

    // In a real app: include pre-aggregated stats per product/supplier.
    const user = JSON.stringify({
      venueId,
      historyDays,
      roundToPack,
      defaultParIfMissing,
      since: since || null,
      // You can attach aggregates: products, pars, lastCounts, supplier-catalog, seasonality, etc.
      // products: [...], usageStats: [...], lastCounts: [...], suppliers: [...]
    });

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Generate suggested orders as normalized JSON for the following context: ${user}` }
      ],
      response_format: { type: 'json_object' }
    });

    const rawText = response.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ error: 'model_returned_non_json' });
    }

    // Validate with Zod
    const normalized = normalizeAIResult(parsed);
    const validation = SuggestionSchema.safeParse(normalized);
    if (!validation.success) {
      return res.status(502).json({ error: 'schema_validation_failed', issues: validation.error.issues });
    }

    return res.json(validation.data);
  } catch (err) {
    console.error('[AI SERVER] /v1/suggest-orders error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(PORT, () => {
  console.log(`[AI SERVER] listening on http://localhost:${PORT}`);
});
