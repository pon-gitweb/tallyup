import { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import NetInfo from '@react-native-community/netinfo';

/**
 * Returns the last known "full stock take completedAt" timestamp for a venue.
 * Implementation note:
 * - Primary source should be a venue-level document (e.g., venues/{venueId}/state.lastStockTakeCompletedAt)
 * - Fallback: scan departmental area docs with { completedAt?: Timestamp } and compute max
 * This hook only exposes the Date | null; fetching logic should live in a service (future).
 */
export function useLastStockTakeCompletedAt(venueId: string | null) {
  const [value, setValue] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!venueId) return;
      const net = await NetInfo.fetch();
      if (!net.isConnected) return;

      // TODO: wire to real service (placeholder: null)
      if (alive) setValue(null);
    })();
    return () => { alive = false; };
  }, [venueId]);

  return value;
}
