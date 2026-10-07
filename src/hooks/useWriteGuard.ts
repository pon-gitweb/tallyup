import { useVenue } from '../context/VenueProvider';
import { evaluateWriteGuard, WriteAction, WriteGuardResult } from '../services/billing/writeGuard';

/**
 * Hook wrapping evaluateWriteGuard with live context values.
 * Gets enforce, ready, accessMode, venueType, and cycleActive from VenueProvider;
 * callers supply the action and, for START_COUNT, whether this area already has startedAt.
 *
 * Usage: const guard = useWriteGuard('PRODUCT_WRITE');
 *        if (!guard.allowed) { Alert.alert(...); return; }
 */
export function useWriteGuard(
  action: WriteAction,
  opts?: { areaStarted?: boolean },
): WriteGuardResult {
  const { billingState, ready, venueType, enforceReadOnly, stocktakeActive } = useVenue();
  return evaluateWriteGuard({
    enforce: enforceReadOnly,
    ready,
    accessMode: billingState.accessMode,
    venueType,
    action,
    areaStarted: opts?.areaStarted ?? false,
    cycleActive: stocktakeActive,
  });
}
