export type WriteAction =
  | 'START_COUNT'
  | 'PRODUCT_WRITE'
  | 'STRUCTURE_WRITE'
  | 'INVOICE_POST'
  | 'ORDER_WRITE'
  | 'RESET_STOCKTAKE';

export interface WriteGuardInput {
  enforce: boolean;
  ready: boolean;
  accessMode: 'full' | 'readOnly';
  venueType: string | null;
  action: WriteAction;
  /** Only relevant for START_COUNT: area's startedAt is non-null. */
  areaStarted?: boolean;
  /** Only relevant for START_COUNT: venue.stocktakeActive is true. */
  cycleActive?: boolean;
}

export interface WriteGuardResult {
  allowed: boolean;
  reason: 'ok' | 'read_only';
}

/**
 * Pure, synchronous gate for write actions in readOnly venues.
 *
 * Blocks ONLY when: enforce AND ready AND accessMode=readOnly AND not festival.
 * Everything else fast-passes — enforce=false or ready=false can never block.
 */
export function evaluateWriteGuard({
  enforce,
  ready,
  accessMode,
  venueType,
  action,
  areaStarted = false,
  cycleActive = false,
}: WriteGuardInput): WriteGuardResult {
  if (!enforce) return { allowed: true, reason: 'ok' };
  if (!ready) return { allowed: true, reason: 'ok' };
  if (accessMode !== 'readOnly') return { allowed: true, reason: 'ok' };
  if (venueType === 'festival') return { allowed: true, reason: 'ok' };

  // enforce=true, ready=true, accessMode='readOnly', non-festival venue
  if (action === 'START_COUNT') {
    // Allow resuming an area already started, or continuing an active cycle.
    // Block only when the user is attempting to open a brand-new cycle.
    if (areaStarted || cycleActive) return { allowed: true, reason: 'ok' };
  }

  return { allowed: false, reason: 'read_only' };
}
