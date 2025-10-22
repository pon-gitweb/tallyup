import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- Sprint 3: /api/suggest-orders (minimal overlay passthrough) ---
app.post('/api/suggest-orders', (req, res) => {
  try {
    const body = req.body || {};
    const { venueId, baseline } = body;

    if (!venueId || !baseline) {
      res.status(400).json({ error: 'missing venueId/baseline' });
      return;
    }

    const aiRemaining = Number.isFinite(Number(req.headers['x-ai-remaining']))
      ? Number(req.headers['x-ai-remaining'])
      : 99;

    res.setHeader('x-ai-remaining', String(aiRemaining));
    res.setHeader('x-ai-retry-after', '0');

    res.json({
      buckets: baseline.buckets || {},
      unassigned: baseline.unassigned || { lines: [] },
      meta: {
        rationale: 'overlay_passthrough',
        factors: ['Server reachable', 'LLM not yet applied'],
        aiRemaining,
        retryAfterSeconds: 0,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// --- Sprint 3: /api/variance-explain (minimal explainer) ---
/**
 * Input: { venueId, itemName, varianceQty, varianceValue, par, lastCountQty, theoreticalOnHand,
 *          departmentId, recentSoldQty, recentReceivedQty, lastDeliveryAt }
 * Output: { summary, factors[], missing[], confidence, meta }
 */
app.post('/api/variance-explain', (req, res) => {
  try {
    const b = req.body || {};
    const vq = Number(b.varianceQty ?? 0);
    const rv = Number(b.recentSoldQty ?? NaN);
    const rr = Number(b.recentReceivedQty ?? NaN);
    const factors = [];
    const missing = [];

    if (!b.itemName) missing.push('itemName');
    if (!('varianceQty' in b)) missing.push('varianceQty');

    if (Number.isFinite(rv) && Math.abs(rv) > 0) factors.push(`Recent sales ${rv > 0 ? 'increase' : 'decline'} (${rv})`);
    if (Number.isFinite(rr) && Math.abs(rr) > 0) factors.push(`Recent delivery impact (${rr})`);
    if (b.lastDeliveryAt) factors.push(`Last delivery at ${b.lastDeliveryAt}`);
    if (b.par != null) factors.push(`PAR set to ${b.par}`);

    let summary = 'Variance likely due to normal count fluctuations.';
    if (vq < 0 && Number.isFinite(rv) && rv > 0) summary = 'Shortage likely from sales outpacing counts since last stock take.';
    if (vq > 0 && Number.isFinite(rr) && rr > 0) summary = 'Excess likely from recent delivery not fully reconciled.';
    if (!factors.length) factors.push('Limited context available');

    const confidence = Math.min(
      0.95,
      Math.max(
        0.4,
        (Number.isFinite(rv) ? 0.15 : 0) +
          (Number.isFinite(rr) ? 0.15 : 0) +
          (b.lastDeliveryAt ? 0.1 : 0) +
          (b.par != null ? 0.1 : 0)
      )
    );

    const aiRemaining = 99;
    res.setHeader('x-ai-remaining', String(aiRemaining));
    res.setHeader('x-ai-retry-after', '0');

    res.json({
      summary,
      factors,
      missing,
      confidence,
      meta: { aiRemaining, retryAfterSeconds: 0 },
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// --- Guard listen for local dev only ---
// Skip listen() in:
//  - Firebase Emulator: FUNCTIONS_EMULATOR is set
//  - Cloud Functions (Gen 1): FUNCTION_TARGET is set
//  - Cloud Run / Gen 2: K_SERVICE is set
if (
  !process.env.FUNCTIONS_EMULATOR &&
  !process.env.FUNCTION_TARGET &&
  !process.env.K_SERVICE
) {
  app.listen(port, () => {
    console.log(`[AI SERVER] listening on http://localhost:${port}`);
  });
}

// ESM default export for Functions to import
export default app;
