// @ts-nocheck
// Beta pilot: AI features are always unlocked.
// Keep the API surface so existing screens don't break.

/**
 * Used by variance AI buttons etc.
 * For beta: always return true and log once.
 */
export async function isEntitled(venueId: string, uid: string): Promise<boolean> {
  try {
    console.log('[Entitlement:isEntitled] beta hard-load TRUE', { venueId, uid });
  } catch {}
  return true;
}

/**
 * Used by SuggestedOrderScreen to decide if AI mode is allowed.
 * For beta: always entitled = true, no network call.
 */
export async function checkEntitlement(venueId: string): Promise<{ ok: boolean; entitled: boolean; source: string }> {
  try {
    console.log('[Entitlement:checkEntitlement] beta hard-load TRUE', { venueId });
  } catch {}
  return { ok: true, entitled: true, source: 'beta-hardload' };
}

/**
 * Legacy helper used in some older flows.
 * For beta: accept everything and mark as DEV_HARDLOAD.
 */
export async function validatePromoCode(venueId: string, uid: string, code: string) {
  try {
    console.log('[Entitlement:validatePromoCode] beta stub accept-all', { venueId, uid, code });
  } catch {}
  return { ok: true, unlocked: true, source: 'DEV_HARDLOAD', code };
}

/**
 * Stub cache clearer so callers don't explode.
 */
export async function clearEntitlementCache() {
  // No-op while hard-loaded for beta
}
