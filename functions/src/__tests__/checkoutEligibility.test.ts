import { checkCheckoutEligibility, VenueForEligibility } from '../checkoutEligibility';

// ── helpers ───────────────────────────────────────────────────────────────────

const OWNER_UID = 'uid-owner';

/** A minimal venue that should pass all checks. */
function trialVenue(overrides: Partial<VenueForEligibility> = {}): VenueForEligibility {
  return {
    ownerUid: OWNER_UID,
    subscription: { status: 'canceled' },
    legacyFreeAccess: false,
    venueType: 'bar',
    ...overrides,
  };
}

function ok(lookupKey = 'core_monthly_rolling', uid = OWNER_UID, venueOverrides: Partial<VenueForEligibility> = {}) {
  return checkCheckoutEligibility({ uid, venue: trialVenue(venueOverrides), lookupKey, hasTrialState: true });
}

// ── owner on trial path ───────────────────────────────────────────────────────

describe('checkCheckoutEligibility — allowed cases', () => {
  it.each([
    ['core_monthly_rolling'],
    ['core_annual'],
  ])('owner buying %s on trial path → ok', (key) => {
    expect(ok(key)).toEqual({ ok: true });
  });

  it('canceled subscription on trial-path venue → ok (can re-subscribe)', () => {
    expect(ok('core_monthly_rolling', OWNER_UID, { subscription: { status: 'canceled' } })).toEqual({ ok: true });
  });

  it('no subscription at all on trial-path venue → ok', () => {
    expect(ok('core_monthly_rolling', OWNER_UID, { subscription: null })).toEqual({ ok: true });
  });

  it('subscription status absent on trial-path venue → ok', () => {
    expect(ok('core_monthly_rolling', OWNER_UID, { subscription: undefined })).toEqual({ ok: true });
  });
});

// ── ownership ─────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — ownership checks', () => {
  it('non-owner uid → 403', () => {
    const r = checkCheckoutEligibility({ uid: 'uid-other', venue: trialVenue(), lookupKey: 'core_monthly_rolling', hasTrialState: true });
    expect(r).toEqual({ ok: false, status: 403, error: 'Only the venue owner can subscribe' });
  });

  it('member who is not the owner → 403', () => {
    const r = checkCheckoutEligibility({ uid: 'uid-member', venue: trialVenue(), lookupKey: 'core_monthly_rolling', hasTrialState: true });
    expect(r).toEqual({ ok: false, status: 403, error: 'Only the venue owner can subscribe' });
  });

  it('uid undefined → 403 (not ok)', () => {
    const r = checkCheckoutEligibility({ uid: undefined, venue: trialVenue(), lookupKey: 'core_monthly_rolling', hasTrialState: true });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('uid null → 403 (not ok)', () => {
    const r = checkCheckoutEligibility({ uid: null, venue: trialVenue(), lookupKey: 'core_monthly_rolling', hasTrialState: true });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

// ── lookup key ────────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — lookup key checks', () => {
  it('add-on key (ai_meter_extension) → 400', () => {
    const r = ok('ai_meter_extension');
    expect(r).toEqual({ ok: false, status: 400, error: 'This plan is not available for purchase yet' });
  });

  it('unknown key → 400', () => {
    const r = ok('totally_unknown_plan');
    expect(r).toEqual({ ok: false, status: 400, error: 'This plan is not available for purchase yet' });
  });

  it('empty string key → 400', () => {
    const r = ok('');
    expect(r).toEqual({ ok: false, status: 400, error: 'This plan is not available for purchase yet' });
  });
});

// ── subscription status ───────────────────────────────────────────────────────

describe('checkCheckoutEligibility — existing subscription', () => {
  it('active subscription → 409', () => {
    const r = ok('core_monthly_rolling', OWNER_UID, { subscription: { status: 'active' } });
    expect(r).toEqual({ ok: false, status: 409, error: 'This venue already has an active subscription' });
  });

  it('trialing subscription → 409', () => {
    const r = ok('core_monthly_rolling', OWNER_UID, { subscription: { status: 'trialing' } });
    expect(r).toEqual({ ok: false, status: 409, error: 'This venue already has an active subscription' });
  });
});

// ── managed venue (legacyFreeAccess / festival / no trialState) ───────────────

describe('checkCheckoutEligibility — managed venue path', () => {
  it('legacyFreeAccess venue → 403 managed', () => {
    const r = ok('core_monthly_rolling', OWNER_UID, { legacyFreeAccess: true });
    expect(r).toEqual({ ok: false, status: 403, error: "This venue's plan is managed by Hosti" });
  });

  it('festival venueType → 403 managed', () => {
    const r = ok('core_monthly_rolling', OWNER_UID, { venueType: 'festival' });
    expect(r).toEqual({ ok: false, status: 403, error: "This venue's plan is managed by Hosti" });
  });

  it('no trialState (hasTrialState=false) → 403 managed (pilot/founder path)', () => {
    const r = checkCheckoutEligibility({ uid: OWNER_UID, venue: trialVenue(), lookupKey: 'core_monthly_rolling', hasTrialState: false });
    expect(r).toEqual({ ok: false, status: 403, error: "This venue's plan is managed by Hosti" });
  });
});

// ── venue missing ─────────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — venue missing', () => {
  it('null venue → 404', () => {
    const r = checkCheckoutEligibility({ uid: OWNER_UID, venue: null, lookupKey: 'core_monthly_rolling', hasTrialState: false });
    expect(r).toEqual({ ok: false, status: 404, error: 'Venue not found' });
  });
});

// ── priority ordering ─────────────────────────────────────────────────────────

describe('checkCheckoutEligibility — rule priority', () => {
  it('venue missing is checked before uid (404, not 403)', () => {
    const r = checkCheckoutEligibility({ uid: 'uid-other', venue: null, lookupKey: 'core_monthly_rolling', hasTrialState: false });
    expect(r).toEqual({ ok: false, status: 404, error: 'Venue not found' });
  });

  it('ownership checked before key validation (403, not 400)', () => {
    const r = checkCheckoutEligibility({ uid: 'uid-other', venue: trialVenue(), lookupKey: 'bad_key', hasTrialState: true });
    expect(r).toEqual({ ok: false, status: 403, error: 'Only the venue owner can subscribe' });
  });

  it('key validation checked before subscription status (400, not 409)', () => {
    const r = checkCheckoutEligibility({
      uid: OWNER_UID,
      venue: trialVenue({ subscription: { status: 'active' } }),
      lookupKey: 'bad_key',
      hasTrialState: true,
    });
    expect(r).toEqual({ ok: false, status: 400, error: 'This plan is not available for purchase yet' });
  });
});
