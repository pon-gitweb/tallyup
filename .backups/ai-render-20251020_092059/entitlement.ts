// @ts-nocheck
// TEMP: Hard-load AI entitlement for internal dev.
// This makes isEntitled() always true, bypassing the Paywall everywhere.
// Revert before releasing to testers.

export async function isEntitled(venueId: string, uid: string): Promise<boolean> {
  return true; // <-- hard-loaded
}

// Keep the API surface so callers don't break:
export async function validatePromoCode(venueId: string, uid: string, code: string) {
  return { ok: true, unlocked: true, source: 'DEV_HARDLOAD', code };
}

export async function clearEntitlementCache() {
  // no-op while hard-loaded
}
