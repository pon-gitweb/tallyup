import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Simple in-memory entitlement (dev-only)
const entitledByVenue = new Set();

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tallyup-ai-server', ts: Date.now() });
});

// Entitlement: GET (check) and POST (grant for dev)
app.get('/api/entitlement', (req, res) => {
  const { uid, venueId } = req.query;
  if (!uid || !venueId) return res.status(400).json({ ok: false, error: 'uid and venueId required' });
  const key = `${uid}::${venueId}`;
  res.json({ ok: true, entitled: entitledByVenue.has(key) });
});

app.post('/api/entitlement', (req, res) => {
  const { uid, venueId } = req.body || {};
  if (!uid || !venueId) return res.status(400).json({ ok: false, error: 'uid and venueId required' });
  const key = `${uid}::${venueId}`;
  entitledByVenue.add(key);
  res.json({ ok: true, entitled: true });
});

// Promo validation (dev): reads comma-separated codes from DEV_PROMO_CODES
app.post('/api/validate-promo', (req, res) => {
  const { uid, venueId, code } = req.body || {};
  if (!uid || !venueId || !code) return res.status(400).json({ ok: false, error: 'uid, venueId, code required' });

  const raw = (process.env.DEV_PROMO_CODES || '').trim();
  const codes = raw ? raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
  const valid = codes.includes(String(code).trim().toUpperCase());

  if (!valid) return res.status(400).json({ ok: false, error: 'Invalid promo' });

  // Grant entitlement on valid promo
  const key = `${uid}::${venueId}`;
  entitledByVenue.add(key);
  res.json({ ok: true, entitled: true, code });
});

// Suggest orders (stub)
app.post('/api/suggest-orders', (req, res) => {
  res.json({
    ok: true,
    summary: { suppliersWithLines: 1, totalLines: 2 },
    perSupplierCounts: { demo_supplier: 2 },
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

// 404 guard
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.listen(port, () => {
  console.log(`[AI SERVER] listening on http://localhost:${port}`);
});
