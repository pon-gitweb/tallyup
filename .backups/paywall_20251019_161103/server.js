import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// -------- Dev in-memory state (do not use in prod) --------
const entitledByVenue = new Set(); // track venueIds with entitlement
const DEV_PROMO_CODES = String(process.env.DEV_PROMO_CODES || '')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

// -------- Utilities --------
function isDevPromo(code) {
  if (!code) return false;
  return DEV_PROMO_CODES.includes(String(code).trim().toUpperCase());
}

function planPriceCents(plan) {
  // simple stub pricing
  return plan === 'yearly' ? 19000 : 1900; // $190.00 / $19.00
}

// -------- Health --------
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tallyup-ai-dev', time: new Date().toISOString() });
});

// -------- Entitlement (dev-only) --------
app.get('/api/entitlement', (req, res) => {
  const venueId = String(req.query.venueId || '');
  const entitled = venueId && entitledByVenue.has(venueId);
  res.json({ ok: true, entitled: !!entitled });
});

app.post('/api/entitlement/dev-grant', (req, res) => {
  const { venueId } = req.body || {};
  if (!venueId) return res.status(400).json({ ok: false, error: 'venueId required' });
  entitledByVenue.add(String(venueId));
  res.json({ ok: true, entitled: true });
});

// -------- Promo validation (dev) --------
app.post('/api/validate-promo', (req, res) => {
  const { uid, venueId, code } = req.body || {};
  if (!uid || !venueId) return res.status(400).json({ ok: false, error: 'uid and venueId required' });
  const valid = isDevPromo(code);
  res.json({ ok: true, entitled: !!valid, code: valid ? String(code).toUpperCase() : undefined });
});

// -------- DEV Checkout creation --------
app.post('/api/dev/create-checkout', (req, res) => {
  const { uid, venueId, plan = 'monthly', promoCode } = req.body || {};
  if (!uid || !venueId) return res.status(400).json({ ok: false, error: 'uid and venueId required' });

  // Promo path: free access, no checkout needed
  if (isDevPromo(promoCode)) {
    // Grant entitlement immediately for dev
    entitledByVenue.add(String(venueId));
    return res.json({
      ok: true,
      promoApplied: true,
      amountCents: 0,
      checkoutUrl: null, // not needed for free
    });
  }

  // Regular path: return stub checkout URL
  const amount = planPriceCents(plan);
  const sessionId = Buffer.from(`${uid}:${venueId}:${Date.now()}`).toString('base64url');
  const checkoutUrl = `http://localhost:${port}/dev/checkout?session=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}&venueId=${encodeURIComponent(venueId)}&plan=${encodeURIComponent(plan)}&amount=${amount}`;
  res.json({
    ok: true,
    promoApplied: false,
    amountCents: amount,
    checkoutUrl,
  });
});

// -------- DEV Billing portal URL --------
app.post('/api/dev/portal-url', (req, res) => {
  const { uid, venueId } = req.body || {};
  if (!uid || !venueId) return res.status(400).json({ ok: false, error: 'uid and venueId required' });
  const token = Buffer.from(`${uid}:${venueId}`).toString('base64url');
  const url = `http://localhost:${port}/dev/portal?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(uid)}&venueId=${encodeURIComponent(venueId)}`;
  res.json({ ok: true, url });
});

// -------- DEV HTML pages (very simple) --------
app.get('/dev/checkout', (req, res) => {
  const { uid = '', venueId = '', plan = 'monthly', amount = '1900' } = req.query;
  const amountDollars = (Number(amount) / 100).toFixed(2);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>TallyUp Dev Checkout</title></head>
<body style="font-family:system-ui, -apple-system, Segoe UI, Roboto; padding:24px;">
  <h1>TallyUp — Dev Checkout</h1>
  <p><strong>User:</strong> ${String(uid)}</p>
  <p><strong>Venue:</strong> ${String(venueId)}</p>
  <p><strong>Plan:</strong> ${String(plan)}</p>
  <p><strong>Amount:</strong> $${amountDollars} (stub)</p>
  <button onclick="alert('No real payment in dev. This page proves URL open works.');">Pay (stub)</button>
  <p style="margin-top:24px;"><a href="javascript:window.close()">Close</a></p>
</body>
</html>`);
});

app.get('/dev/portal', (req, res) => {
  const { uid = '', venueId = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>TallyUp Dev Billing Portal</title></head>
<body style="font-family:system-ui, -apple-system, Segoe UI, Roboto; padding:24px;">
  <h1>TallyUp — Dev Billing Portal</h1>
  <p><strong>User:</strong> ${String(uid)}</p>
  <p><strong>Venue:</strong> ${String(venueId)}</p>
  <p>This is a stub portal page. In production, link to your billing provider's portal.</p>
  <p style="margin-top:24px;"><a href="javascript:window.close()">Close</a></p>
</body>
</html>`);
});

// -------- Suggest Orders stub (kept from previous) --------
app.post('/api/suggest-orders', (_req, res) => {
  res.json({
    ok: true,
    strategy: 'dev-stub',
    buckets: {
      demo_supplier: {
        supplierName: 'Demo Supplier',
        lines: [
          { productId: 'Coke330', productName: 'Coke 330ml', qty: 6, cost: 0 },
          { productId: 'Eggs',   productName: 'Eggs',       qty: 6, cost: 0 },
        ],
      },
    },
    unassigned: { lines: [] },
  });
});

// -------- 404 guard --------
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.listen(port, () => {
  console.log(`[AI SERVER] listening on http://localhost:${port}`);
});
