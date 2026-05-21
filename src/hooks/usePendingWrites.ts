import { useState, useEffect } from 'react';
import { waitForPendingWrites } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useNetworkState } from './useNetworkState';

export function usePendingWrites() {
  const { isOnline, wasOffline } = useNetworkState();
  const [hasPending, setHasPending] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!wasOffline || !isOnline) {
      setHasPending(false);
      return;
    }
    // Came back online after being offline — wait for pending writes
    setHasPending(true);
    setSynced(false);
    waitForPendingWrites(db)
      .then(() => {
        setHasPending(false);
        setSynced(true);
        const t = setTimeout(() => setSynced(false), 3000);
        return () => clearTimeout(t);
      })
      .catch(() => {
        setHasPending(false);
      });
  }, [isOnline, wasOffline]);

  return { hasPending, synced };
}
