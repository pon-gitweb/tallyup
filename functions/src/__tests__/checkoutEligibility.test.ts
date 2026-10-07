import { checkCheckoutEligibility, EligibilityInput, VenueForEligibility } from '../checkoutEligibility';

// ── helpers ───────────────────────────────────────────────────────────────────

const OWNER_UID = 'uid-owner';
const VALID_VENUE_ID = 'venue123';
const VALID_SUCCESS_URL = 'https://app.hosti.co.nz/success';
const VALID_CANCEL_URL = 'https://app.hosti.co.nz/cancel';

function trialVenue(overrides: Partial<VenueForEligibility> = {}): VenueForEligibility {
  return {
    ownerUid: OWNER_UID,
    subscription: { status: 'canceled' },
    legacyFreeAccess: false,
    venueType: 'bar',
    ...overrides,
  };
}

function base(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    priceId: undefined,
    venueId: VALID_VENUE_ID,
    quantity: undefined,
    successUrl: VALID_SUCCESS_URL,
    cancelUrl: VALID_CANCEL_URL,
    uid: OWNER_UID,
    venue: trialVenue(),
    lookupKey: 'core_monthly_rolling',
    hasTrialState: true,
    ...overrides,
  };
}

// ── owner on trial path ───────────────────────────────────────────────────────

describe('checkCheckoutEligibility — allowed cases', () => {
  it.each([
    ['core_monthly_rolling'],
    ['core_annual'],
  ])('owner buying %s on trial path → ok', (key) => {
    expect(checkCheckoutEligibility(base({ lookupKey: key }))).toEqual({ ok: true });
  });

  it('quantity 1 → ok', () => {
    expect(checkCheckoutEligibility(base({ quantity: 1 }))).toEqual({ ok: true });
  });

  it('quantity absent (undefined) → ok', () => {
    expect(checkCheckoutEligibility(base({ quantity: undefined }))).toEqual({ ok: true });
  });

  it('quantity null → ok (treated as absent)', () => {
    expect(checkCheckoutEligibility(base({ quantity: null }))).toEqual({ ok: true });
  });

  it('successUrl on tallyup-f1463.web.app → ok', () => {
    expect(checkCheckoutEligibility(base({
      successUrl: 'https://tallyup-f1463.web.app/success',
      cancelUrl: 'https://tallyup-f1463.web.app/cancel',
    }))).toEqual({ ok: true });
  });

  it('successUrl on app.hosti.co.nz → ok', () => {
    expect(checkCheckoutEligibility(base({
      successUrl: 'https://app.hosti.co.nz/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.hosti.co.nz/billing',
    }))).toEqual({ ok: true });
  });

  it('canceled subscription on trial-path venue → ok', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ subscription: { status: 'canceled' } }) }))).toEqual({ ok: true });
  });

  it('no subscription on trial-path venue → ok', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ subscription: null }) }))).toEqual({ ok: true });
  });
});

// ── priceId ───────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — priceId rejected', () => {
  it('priceId present alongside a valid lookupKey → 400 "Price IDs are not accepted"', () => {
    expect(checkCheckoutEligibility(base({ priceId: 'price_1ABC' }))).toEqual({
      ok: false, status: 400, error: 'Price IDs are not accepted',
    });
  });

  it('priceId empty string → ok (treated as absent)', () => {
    expect(checkCheckoutEligibility(base({ priceId: '' }))).toEqual({ ok: true });
  });

  it('priceId null → ok (treated as absent)', () => {
    expect(checkCheckoutEligibility(base({ priceId: null }))).toEqual({ ok: true });
  });
});

// ── venueId format ────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — venueId format', () => {
  it.each([
    ['a/b',        'slash'],
    ['../x',       'path traversal'],
    ['',           'empty'],
    ['ab',         'too short (< 6 chars)'],
    ['a'.repeat(65), '65-char id (> 64)'],
  ])('venueId %j (%s) → 400 "Invalid venue"', (id) => {
    expect(checkCheckoutEligibility(base({ venueId: id }))).toEqual({
      ok: false, status: 400, error: 'Invalid venue',
    });
  });

  it('valid alphanum venueId → ok', () => {
    expect(checkCheckoutEligibility(base({ venueId: 'abc123XYZ_-' }))).toEqual({ ok: true });
  });

  it('exactly 6-char venueId → ok (lower bound)', () => {
    expect(checkCheckoutEligibility(base({ venueId: 'ab1234' }))).toEqual({ ok: true });
  });

  it('exactly 64-char venueId → ok (upper bound)', () => {
    expect(checkCheckoutEligibility(base({ venueId: 'a'.repeat(64) }))).toEqual({ ok: true });
  });
});

// ── quantity ──────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — quantity', () => {
  it.each([
    [0],
    [2],
    [-1],
    [1.5],
  ])('quantity %d → 400 "Invalid quantity"', (q) => {
    expect(checkCheckoutEligibility(base({ quantity: q }))).toEqual({
      ok: false, status: 400, error: 'Invalid quantity',
    });
  });

  it('quantity "1" (string) → 400 (wrong type)', () => {
    expect(checkCheckoutEligibility(base({ quantity: '1' as any }))).toEqual({
      ok: false, status: 400, error: 'Invalid quantity',
    });
  });
});

// ── return URLs ───────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — return URL validation', () => {
  it('http:// URL → 400 "Invalid return URL"', () => {
    expect(checkCheckoutEligibility(base({ successUrl: 'http://app.hosti.co.nz/success' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });

  it('lookalike host (app.hosti.co.nz.evil.com) → 400', () => {
    expect(checkCheckoutEligibility(base({ successUrl: 'https://app.hosti.co.nz.evil.com/success' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });

  it('javascript: URL → 400', () => {
    expect(checkCheckoutEligibility(base({ successUrl: 'javascript:alert(1)' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });

  it('URL with credentials → 400', () => {
    expect(checkCheckoutEligibility(base({ successUrl: 'https://user:pass@app.hosti.co.nz/success' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });

  it('unknown hostname → 400', () => {
    expect(checkCheckoutEligibility(base({ successUrl: 'https://example.com/success' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });

  it('cancelUrl invalid while successUrl is valid → 400', () => {
    expect(checkCheckoutEligibility(base({ cancelUrl: 'https://example.com/cancel' }))).toEqual({
      ok: false, status: 400, error: 'Invalid return URL',
    });
  });
});

// ── ownership ─────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — ownership checks', () => {
  it('non-owner uid → 403', () => {
    expect(checkCheckoutEligibility(base({ uid: 'uid-other' }))).toEqual({
      ok: false, status: 403, error: 'Only the venue owner can subscribe',
    });
  });

  it('member who is not the owner → 403', () => {
    expect(checkCheckoutEligibility(base({ uid: 'uid-member' }))).toEqual({
      ok: false, status: 403, error: 'Only the venue owner can subscribe',
    });
  });

  it('uid undefined → 403 (not ok)', () => {
    expect(checkCheckoutEligibility(base({ uid: undefined }))).toMatchObject({ ok: false, status: 403 });
  });

  it('uid null → 403 (not ok)', () => {
    expect(checkCheckoutEligibility(base({ uid: null }))).toMatchObject({ ok: false, status: 403 });
  });
});

// ── lookup key ────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — lookup key checks', () => {
  it('add-on key (ai_meter_extension) → 400', () => {
    expect(checkCheckoutEligibility(base({ lookupKey: 'ai_meter_extension' }))).toEqual({
      ok: false, status: 400, error: 'This plan is not available for purchase yet',
    });
  });

  it('unknown key → 400', () => {
    expect(checkCheckoutEligibility(base({ lookupKey: 'totally_unknown_plan' }))).toEqual({
      ok: false, status: 400, error: 'This plan is not available for purchase yet',
    });
  });

  it('empty string key → 400', () => {
    expect(checkCheckoutEligibility(base({ lookupKey: '' }))).toEqual({
      ok: false, status: 400, error: 'This plan is not available for purchase yet',
    });
  });
});

// ── existing subscription ─────────────────────────────────────────────────────

describe('checkCheckoutEligibility — existing subscription', () => {
  it('active subscription → 409', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ subscription: { status: 'active' } }) }))).toEqual({
      ok: false, status: 409, error: 'This venue already has an active subscription',
    });
  });

  it('trialing subscription → 409', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ subscription: { status: 'trialing' } }) }))).toEqual({
      ok: false, status: 409, error: 'This venue already has an active subscription',
    });
  });
});

// ── managed venue ─────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — managed venue path', () => {
  it('legacyFreeAccess venue → 403 managed', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ legacyFreeAccess: true }) }))).toEqual({
      ok: false, status: 403, error: "This venue's plan is managed by Hosti",
    });
  });

  it('festival venueType → 403 managed', () => {
    expect(checkCheckoutEligibility(base({ venue: trialVenue({ venueType: 'festival' }) }))).toEqual({
      ok: false, status: 403, error: "This venue's plan is managed by Hosti",
    });
  });

  it('no trialState (hasTrialState=false) → 403 managed (pilot/founder path)', () => {
    expect(checkCheckoutEligibility(base({ hasTrialState: false }))).toEqual({
      ok: false, status: 403, error: "This venue's plan is managed by Hosti",
    });
  });
});

// ── venue missing ─────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — venue missing', () => {
  it('null venue → 404', () => {
    expect(checkCheckoutEligibility(base({ venue: null }))).toEqual({
      ok: false, status: 404, error: 'Venue not found',
    });
  });
});

// ── rule priority ─────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — rule priority', () => {
  it('format checks before venue (priceId rejected even if venue is null)', () => {
    expect(checkCheckoutEligibility(base({ priceId: 'price_1', venue: null }))).toEqual({
      ok: false, status: 400, error: 'Price IDs are not accepted',
    });
  });

  it('venueId format before venue (bad id rejected even if venue is null)', () => {
    expect(checkCheckoutEligibility(base({ venueId: 'a/b', venue: null }))).toEqual({
      ok: false, status: 400, error: 'Invalid venue',
    });
  });

  it('venue missing checked before uid (404, not 403)', () => {
    expect(checkCheckoutEligibility(base({ uid: 'uid-other', venue: null }))).toEqual({
      ok: false, status: 404, error: 'Venue not found',
    });
  });

  it('ownership checked before lookupKey validation (403, not 400)', () => {
    expect(checkCheckoutEligibility(base({ uid: 'uid-other', lookupKey: 'bad_key' }))).toEqual({
      ok: false, status: 403, error: 'Only the venue owner can subscribe',
    });
  });

  it('lookupKey checked before subscription status (400, not 409)', () => {
    expect(checkCheckoutEligibility(base({
      lookupKey: 'bad_key',
      venue: trialVenue({ subscription: { status: 'active' } }),
    }))).toEqual({
      ok: false, status: 400, error: 'This plan is not available for purchase yet',
    });
  });
});
