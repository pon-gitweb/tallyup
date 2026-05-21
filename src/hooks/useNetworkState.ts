import NetInfo from '@react-native-community/netinfo';
import { useState, useEffect, useRef } from 'react';

export function useNetworkState() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (!online) {
        wasOfflineRef.current = true;
        setWasOffline(true);
      }
      setIsOnline(online);
    });
    return () => unsubscribe();
  }, []);

  const clearWasOffline = () => setWasOffline(false);

  return { isOnline, wasOffline, clearWasOffline };
}
