// server/server.js
// Phase-2 AI Suggested Orders server (Express + OpenAI)
// - Entitlement & promo stubs
// - /v1/suggest-orders (AI or safe fallback)
// - Optional Firestore logging (no hard dependency)
// - Local file logging fallback

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ---------- Optional Admin bootstrap (no hard dependency) ----------
function initAdminIfAvailable() {
  try {
    const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');

    const app =
      getApps().length
        ? getApps()[0]
        : initializeApp({
            credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
              ? cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS))
              : applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID || undefined,
          });

    const db = getFirestore(app);
    console.log('[AI SERVER] Firestore admin available: logging to Firestore');
    return db;
  } catch (e) {
    console.log('[AI SERVER] firebase-admin not available — logs will be written to local files');
    return null;
  }
}

const fs = require('fs');
const path = require('path');
const ADMIN_DB = initAdminIfAvailable();

async function logSuggestion(payload) {
  const safe = {
    venueId: String(payload?.venueId || ''),
    request: payload?.request || {},
    response: payload?.response || {},
    meta: {
      at: new Date().toISOString(),
      source: 'ai.suggest-orders',
      version: 1,
    },
  };

  if (ADMIN_DB) {
    try {
      const col = ADMIN_DB.collection('venues').doc(safe.venueId).collection('aiRuns');
      await col.add(safe);
      return;
    } catch (err) {
      console.warn('[AI SERVER] Firestore log failed, using file fallback:', err?.message);
    }
  }

  try {
    const file = path.join(__dirname, '..', 'logs', `aiRun-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(safe, null, 2));
  } catch (err) {
    console.warn('[AI SERVER] file log failed:', err?.message);
  }
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: true }));

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

// Dev promo codes (CSV in .env): DEV_PROMO_CODES=AIACCESS,FREEAI,TRYAI
const DEV_PROMO_CODES = String(process.env.DEV_PROMO_CODES || '')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

// In-memory dev entitlements so the app “sticks” after promo validation
const ENTITLED = new Set(); // key: `${uid}:${venueId}:${feature}`

// ---------- Helpers ----------
function entitlementKey(uid, venueId, feature) {
  return `${uid || ''}:${venueId || ''}:${feature || ''}`;
}

function ok(res, data) { res.status(200).json(data); }
function bad(res, msg) { res.status(400).json({ ok:false, error: msg }); }
function fail(res, e) { res.status(500).json({ ok:false, error: e?.message || 'server-error' }); }

// ---------- Health ----------
app.get('/health', (req, res) => ok(res, { ok:true, ts: Date.now() }));

// ---------- Entitlement check ----------
/**
 * GET /api/entitlement?uid=&venueId=&feature=
 * Returns { ok:true, entitled:boolean, source:string }
 * Dev notes:
 * - Honors in-memory entitlements (after promo redemption)
 * - You can also force entitlement by sending header x-dev-entitled: 1
 */
app.get('/api/entitlement', (req, res) => {
  try {
    const { uid = '', venueId = '', feature = 'ai_suggest' } = req.query || {};
    const devHeader = String(req.headers['x-dev-entitled'] || '').trim();
    if (devHeader === '1') return ok(res, { ok:true, entitled:true, source:'dev-header' });

    const key = entitlementKey(uid, venueId, feature);
    const entitled = ENTITLED.has(key);

    ok(res, { ok:true, entitled, source: entitled ? 'promo-memory' : 'none' });
  } catch (e) { fail(res, e); }
});

// ---------- Promo validation ----------
/**
 * POST /api/validate-promo
 * Body: { code, uid, venueId, feature }
 * Accepts codes from DEV_PROMO_CODES; marks in-memory entitlement.
 */
app.post('/api/validate-promo', (req, res) => {
  try {
    const { code = '', uid = '', venueId = '', feature = 'ai_suggest' } = req.body || {};
    if (!code) return bad(res, 'missing-code');

    const normalized = String(code).trim().toUpperCase();
    if (!DEV_PROMO_CODES.includes(normalized)) {
      return ok(res, { ok:false, entitled:false, reason:'invalid-code' });
    }
    const key = entitlementKey(uid, venueId, feature);
    ENTITLED.add(key);

    ok(res, { ok:true, entitled:true, token:`DEV-${normalized}` });
  } catch (e) { fail(res, e); }
});

// ---------- AI Suggested Orders ----------
/**
 * POST /v1/suggest-orders
 * Body:
 * {
 *   venueId: string,
 *   historyDays?: number,
 *   roundToPack?: boolean,
 *   defaultParIfMissing?: number,
 *   since?: string|number|null,
 *   // client-aggregated, dieted payload:
 *   products?: Array<{ id, name, par?, packSize?, unitCost?, supplierId?, supplierName? }>,
 *   suppliers?: Array<{ id, name }>,
 *   usage?: Array<{ productId, dailyRate }>,
 *   lastCounts?: Array<{ productId, onHand }>
 * }
 *
 * Returns (normalized):
 * {
 *   buckets: {
 *     [supplierId]: {
 *       supplierName?: string,
 *       lines: Array<{ productId, productName, qty, cost?, packSize? }>
 *     }
 *   },
 *   unassigned: { lines: Array<...> }
 * }
 */
app.post('/v1/suggest-orders', async (req, res) => {
  const {
    venueId,
    historyDays = 14,
    roundToPack = true,
    defaultParIfMissing = 6,
    since = null,
    products = [],
    suppliers = [],
    usage = [],
    lastCounts = [],
  } = req.body || {};

  if (!venueId) return bad(res, 'missing-venueId');

  // Build a minimal, deterministic suggestion without OpenAI if key missing
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  const useOpenAI = !!OPENAI_API_KEY;

  // Tiny helper to compute qty = max(1, par - onHand, dailyRate*leadTime, ...)
  function mathQty(p) {
    const par = Number.isFinite(p.par) ? Number(p.par) : defaultParIfMissing;
    const onHand = Number(lastCounts.find(x => x.productId === p.id)?.onHand || 0);
    let need = Math.max(1, Math.round(par - onHand));
    if (roundToPack && Number.isFinite(p.packSize) && p.packSize > 1) {
      const packs = Math.max(1, Math.ceil(need / p.packSize));
      need = packs * p.packSize;
    }
    return need;
  }

  // Greedy baseline as a fallback and as a guardrail
  const baseline = (() => {
    const buckets = {};
    const unassigned = [];
    for (const p of Array.isArray(products) ? products : []) {
      const line = {
        productId: p.id,
        productName: p.name || p.id,
        qty: mathQty(p),
        cost: Number(p.unitCost || 0),
        packSize: Number.isFinite(p.packSize) ? Number(p.packSize) : undefined,
      };
      const sid = p.supplierId || '';
      if (sid) {
        if (!buckets[sid]) buckets[sid] = { supplierName: p.supplierName || undefined, lines: [] };
        // dedupe by productId
        const seen = new Set(buckets[sid].lines.map(l => l.productId));
        if (!seen.has(line.productId)) buckets[sid].lines.push(line);
      } else {
        const seen = new Set(unassigned.map(l => l.productId));
        if (!seen.has(line.productId)) unassigned.push(line);
      }
    }
    return { buckets, unassigned: { lines: unassigned } };
  })();

  // If no key, return baseline but still log
  if (!useOpenAI) {
    try {
      await logSuggestion({
        venueId,
        request: { historyDays, roundToPack, defaultParIfMissing, since, counts: lastCounts?.length || 0, products: products?.length || 0 },
        response: baseline,
      });
    } catch {}
    return ok(res, baseline);
  }

  // With OpenAI: ask for adjustments and rebalancing; guard with baseline
  try {
    // Compose a compact prompt (data diet); we clamp lists to keep tokens in check
    const maxItems = 250; // more than enough for phone payloads
    const payload = {
      venueId,
      historyDays,
      rules: {
        roundToPack,
        defaultParIfMissing,
        goal: 'suggest sensible order quantities by supplier; respect pack size; avoid zero qty; return normalized JSON',
      },
      suppliers: (suppliers || []).slice(0, 500),
      products: (products || []).slice(0, maxItems).map(p => ({
        id: p.id, name: p.name,
        par: Number.isFinite(p.par) ? Number(p.par) : undefined,
        packSize: Number.isFinite(p.packSize) ? Number(p.packSize) : undefined,
        unitCost: Number.isFinite(p.unitCost) ? Number(p.unitCost) : undefined,
        supplierId: p.supplierId || undefined,
        supplierName: p.supplierName || undefined,
      })),
      usage: (usage || []).slice(0, maxItems),
      lastCounts: (lastCounts || []).slice(0, maxItems),
      baseline,
      requiredShape: {
        buckets: {
          supplierId: { supplierName: 'string?', lines: [{ productId: 'string', productName: 'string', qty: 'int>=1', cost: 'number?', packSize: 'int?' }] }
        },
        unassigned: { lines: [{ productId: 'string', productName: 'string', qty: 'int>=1', cost: 'number?', packSize: 'int?' }] }
      }
    };

    // Node 18 has global fetch; call OpenAI responses API directly
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'You are an inventory assistant. Output strictly valid JSON ONLY (no explanation), matching the required shape.' },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        temperature: 0.2,
        max_output_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn('[AI SERVER] OpenAI error:', text);
      try { await logSuggestion({ venueId, request: { ...payload, baseline: undefined }, response: { error: 'openai-failed', text } }); } catch {}
      return ok(res, baseline); // safe fallback
    }

    const data = await resp.json();
    // The Responses API returns { output_text?, output[0]?.content[0]?.text?, or content[0].text }
    let jsonText = '';
    if (data?.output_text) jsonText = data.output_text;
    else if (Array.isArray(data?.output) && data.output[0]?.content?.[0]?.text) jsonText = data.output[0].content[0].text;
    else if (Array.isArray(data?.content) && data.content[0]?.text) jsonText = data.content[0].text;

    let parsed;
    try { parsed = JSON.parse(jsonText); } catch {
      console.warn('[AI SERVER] JSON parse failed; returning baseline');
      try { await logSuggestion({ venueId, request: { ...payload, baseline: undefined }, response: { error: 'json-parse-failed', jsonText } }); } catch {}
      return ok(res, baseline);
    }

    // Validate minimal shape; otherwise fall back
    const buckets = parsed?.buckets && typeof parsed.buckets === 'object' ? parsed.buckets : {};
    const unassigned = parsed?.unassigned && typeof parsed.unassigned === 'object' ? parsed.unassigned : { lines: [] };

    const normalized = {
      buckets: buckets || {},
      unassigned: { lines: Array.isArray(unassigned.lines) ? unassigned.lines : [] },
    };

    // Log success
    try {
      await logSuggestion({
        venueId,
        request: { historyDays, roundToPack, defaultParIfMissing, since, counts: lastCounts?.length || 0, products: products?.length || 0 },
        response: normalized
      });
    } catch {}

    return ok(res, normalized);
  } catch (e) {
    console.warn('[AI SERVER] exception:', e?.message);
    try { await logSuggestion({ venueId, request: { historyDays, roundToPack, defaultParIfMissing, since }, response: { error: e?.message } }); } catch {}
    return ok(res, baseline);
  }
});

// ---------- Start ----------
app.listen(PORT, HOST, () => {
  console.log(`[AI SERVER] listening on http://${HOST}:${PORT}`);
});
