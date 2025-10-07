import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Density = 'comfortable' | 'compact';
const KEY = 'ui:density';

export function useDensity() {
  const [density, setDensity] = useState<Density>('comfortable');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (alive && (saved === 'comfortable' || saved === 'compact')) {
          setDensity(saved);
        }
      } catch {}
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setAndSave = useCallback(async (next: Density) => {
    setDensity(next);
    try {
      await AsyncStorage.setItem(KEY, next);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setAndSave(density === 'comfortable' ? 'compact' : 'comfortable');
  }, [density, setAndSave]);

  return { density, setDensity: setAndSave, toggle, loading };
}
