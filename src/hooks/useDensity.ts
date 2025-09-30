import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Density = 'comfortable' | 'compact';

const KEY = 'ui:density'; // global, per-device; simple and stable

export function useDensity() {
  const [density, setDensityState] = useState<Density>('comfortable');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (mounted && (raw === 'comfortable' || raw === 'compact')) {
          setDensityState(raw);
        }
      } catch {
        // ignore read errors; default 'comfortable'
      }
    })();
    return () => { mounted = false; };
  }, []);

  const setDensity = useCallback(async (d: Density) => {
    setDensityState(d);
    try {
      await AsyncStorage.setItem(KEY, d);
    } catch {
      // best-effort persist only
    }
  }, []);

  const isCompact = density === 'compact';

  return { density, setDensity, isCompact };
}
