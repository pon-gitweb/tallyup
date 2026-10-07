/**
 * checkoutEligibility.ts
 * Pure eligibility gate for POST /stripe/create-checkout-session.
 * No Stripe calls, no Firestore reads — all inputs come from the caller.
 */

export interface VenueForEligibility {
  ownerUid?: string | null;
  subscription?: { status?: string } | null;
  legacyFreeAccess?: boolean | null;
  venueType?: string | null;
}

export interface EligibilityInput {
  // Format fields (validated before any Firestore read)
  priceId?: string | null;
  venueId: string;
  quantity?: number | null;
  successUrl: string;
  cancelUrl: string;
  // Eligibility fields (require Firestore data)
  uid: string | null | undefined;
  venue: VenueForEligibility | null;
  lookupKey: string;
  hasTrialState: boolean;
}

export type EligibilityResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const ALLOWED_LOOKUP_KEYS = new Set(['core_monthly_rolling', 'core_annual']);
const ALLOWED_HOSTS = new Set(['tallyup-f1463.web.app', 'app.hosti.co.nz']);
const VENUE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function isValidReturnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      ALLOWED_HOSTS.has(u.hostname) &&
      u.username === '' &&
      u.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * Returns { ok: true } when the caller is allowed to start a Core checkout,
 * or { ok: false, status, error } with the HTTP status and message to return.
 *
 * Format checks (run first, need no Firestore data):
 *   F1. priceId supplied → 400 "Price IDs are not accepted"
 *   F2. venueId format invalid → 400 "Invalid venue"
 *   F3. quantity not absent/null/1 → 400 "Invalid quantity"
 *   F4. successUrl or cancelUrl not https on an allowed host → 400 "Invalid return URL"
 *
 * Eligibility checks (require venue from Firestore):
 *   E1. Venue missing → 404
 *   E2. uid does not match venue.ownerUid → 403
 *   E3. lookupKey not in the allowed Core set → 400
 *   E4. Subscription already active or trialing → 409
 *   E5. Venue on the managed path (legacyFreeAccess, festival, or no trialState) → 403
 *
 * !hasTrialState is a deliberate simplification meaning "not on the new-customer
 * trial path"; it must be revisited when the pilot year ends (Oct 2027), when
 * pilots become eligible to buy Core directly.
 */
export function checkCheckoutEligibility(input: EligibilityInput): EligibilityResult {
  const { priceId, venueId, quantity, successUrl, cancelUrl, uid, venue, lookupKey, hasTrialState } = input;

  // ── Format checks ─────────────────────────────────────────────────────────
  if (typeof priceId === 'string' && priceId.length > 0) {
    return { ok: false, status: 400, error: 'Price IDs are not accepted' };
  }

  if (!VENUE_ID_RE.test(venueId)) {
    return { ok: false, status: 400, error: 'Invalid venue' };
  }

  if (quantity !== undefined && quantity !== null) {
    if (typeof quantity !== 'number' || quantity !== 1) {
      return { ok: false, status: 400, error: 'Invalid quantity' };
    }
  }

  if (!isValidReturnUrl(successUrl) || !isValidReturnUrl(cancelUrl)) {
    return { ok: false, status: 400, error: 'Invalid return URL' };
  }

  // ── Eligibility checks ────────────────────────────────────────────────────
  if (!venue) {
    return { ok: false, status: 404, error: 'Venue not found' };
  }

  if (!uid || venue.ownerUid !== uid) {
    return { ok: false, status: 403, error: 'Only the venue owner can subscribe' };
  }

  if (!ALLOWED_LOOKUP_KEYS.has(lookupKey)) {
    return { ok: false, status: 400, error: 'This plan is not available for purchase yet' };
  }

  const subStatus = venue.subscription?.status;
  if (subStatus === 'active' || subStatus === 'trialing') {
    return { ok: false, status: 409, error: 'This venue already has an active subscription' };
  }

  if (venue.legacyFreeAccess === true || venue.venueType === 'festival' || !hasTrialState) {
    return { ok: false, status: 403, error: "This venue's plan is managed by Hosti" };
  }

  return { ok: true };
}
