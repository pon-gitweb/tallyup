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
  uid: string | null | undefined;
  venue: VenueForEligibility | null;
  lookupKey: string;
  hasTrialState: boolean;
}

export type EligibilityResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const ALLOWED_LOOKUP_KEYS = new Set(['core_monthly_rolling', 'core_annual']);

/**
 * Returns { ok: true } when the caller is allowed to start a Core checkout,
 * or { ok: false, status, error } with the HTTP status and message to return.
 *
 * Rules (checked in order):
 *   1. Venue missing → 404
 *   2. uid does not match venue.ownerUid → 403
 *   3. lookupKey not in the allowed Core set → 400
 *   4. Subscription already active or trialing → 409
 *   5. Venue is on the managed path (legacyFreeAccess, festival, or no trialState) → 403
 *
 * !hasTrialState is a deliberate simplification meaning "not on the new-customer
 * trial path"; it must be revisited when the pilot year ends (Oct 2027), when
 * pilots become eligible to buy Core directly.
 */
export function checkCheckoutEligibility(input: EligibilityInput): EligibilityResult {
  const { uid, venue, lookupKey, hasTrialState } = input;

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
