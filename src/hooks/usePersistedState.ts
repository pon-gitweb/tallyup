import { useEffect, useRef, useState } from 'react';

let AsyncStorage: any = null;
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch {}

type Options<T> = {
  encode?: (v: T) => string;
  decode?: (s: string) => T;
};

/**
 * Tiny persisted state hook (AsyncStorage). Safe if storage is missing.
 * - Reads once on mount, then writes on changes (debounced).
 * - Returns [value, setValue, hydrated]
 */
export function usePersistedState<T>(key: string, initial: T, opts: Options<T> = {}) {
  const { encode = (v: T) => JSON.stringify(v), decode = (s: string) => JSON.parse(s) as T } = opts;
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const firstWriteSkipped = useRef(false);
  const writeTimer = useRef<any>(null);

  // Read once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!AsyncStorage) { setHydrated(true); return; }
        const raw = await AsyncStorage.getItem(key);
        if (cancelled) return;
        if (raw != null) setValue(decode(raw));
      } catch {
        // no-op
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  // Write on change, skip the very first render write (before hydration)
  useEffect(() => {
    if (!hydrated) return;
    if (!AsyncStorage) return;
    if (!firstWriteSkipped.current) { firstWriteSkipped.current = true; return; }
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      try { await AsyncStorage.setItem(key, encode(value)); } catch {}
    }, 150);
    return () => { if (writeTimer.current) clearTimeout(writeTimer.current); };
  }, [value, hydrated, key, encode]);

  return [value, setValue, hydrated] as const;
}

export default usePersistedState;
