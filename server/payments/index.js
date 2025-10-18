import express from 'express';

export const paymentsRouter = express.Router();

/**
 * POST /api/checkout/create
 * Stub that simulates creating a Checkout Session / PaymentIntent.
 * Returns a fake URL and a fake client secret so the UI can proceed.
 */
paymentsRouter.post('/checkout/create', async (req, res) => {
  try {
    const { uid, venueId, plan, promoCode } = req.body || {};
    if (!uid || !venueId) {
      return res.status(400).json({ ok:false, error: 'uid and venueId are required' });
    }

    const priceTable = {
      monthly: { amount: 2900, currency: 'nzd', interval: 'month' },
      yearly:  { amount: 29000, currency: 'nzd', interval: 'year' }
    };
    const pick = priceTable[plan] || priceTable.monthly;

    const promoApplied = !!promoCode && typeof promoCode === 'string' && promoCode.trim().length > 0;
    const discountedAmount = promoApplied ? Math.round(pick.amount * 0.8) : pick.amount; // 20% off stub

    return res.json({
      ok: true,
      mode: 'stub',
      checkoutUrl: `https://payments.example.test/checkout?plan=${plan||'monthly'}&venue=${venueId}`,
      clientSecret: 'pi_test_secret_stub_123',
      amount: discountedAmount,
      currency: pick.currency,
      interval: pick.interval,
      promoApplied,
    });
  } catch (e) {
    console.error('[payments] /checkout/create error', e);
    return res.status(500).json({ ok:false, error:'internal_error' });
  }
});

/** Health */
paymentsRouter.get('/payments/health', (req, res) => {
  return res.json({ ok: true, service: 'payments', mode: 'stub' });
});

/** Webhook (export path + handler — must be mounted with express.raw at app level) */
export const paymentsWebhookPath = '/webhooks/stripe';
export const paymentsWebhookHandler = (req, res) => {
  try {
    // In real Stripe you’d verify the signature from req.headers['stripe-signature']
    const event = req.body; // raw body in real setup; here it’s fine for stub
    console.log('[payments] webhook received (stub):', event && event.type);
    // TODO (real): on successful event, mark entitlement active for the venue
    return res.json({ received: true, mode: 'stub' });
  } catch (e) {
    console.error('[payments] webhook error', e);
    return res.status(400).send('Webhook Error');
  }
};
