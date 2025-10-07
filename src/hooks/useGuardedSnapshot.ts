// @ts-nocheck
import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Guards a snapshot/ref attach with venueId + connectivity.
 * Accepts either:
 *  - queryBuilder(venueId) => returns { onSnapshot(cb): () => void }
 *  - refBuilder(venueId)   => returns { onSnapshot(cb): () => void }
 */
export function useGuardedSnapshot<T>(
  venueId: string | null,
  attach: (cb: (val: T) => void) => () => void
) {
  const unsubRef = useRef<undefined | (() => void)>(undefined);

  useEffect(() => {
    let alive = true;

    const start = async () => {
      const net = await NetInfo.fetch();
      if (!venueId || !net.isConnected) return;

      const unsub = attach(() => {});
      unsubRef.current = unsub;
    };

    start();

    return () => {
      if (!alive) return;
      alive = false;
      const u = unsubRef.current;
      if (typeof u === 'function') {
        try { u(); } catch {}
      }
      unsubRef.current = undefined;
    };
  }, [venueId]);
}
