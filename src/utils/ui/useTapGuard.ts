import { useRef, useCallback } from 'react';
export function useTapGuard(throttleMs: number = 900) {
  const busyRef = useRef(false);
  const lastAtRef = useRef(0);
  const guard = useCallback(async <T,>(fn: () => Promise<T> | T): Promise<T | undefined> => {
    const now = Date.now();
    if (busyRef.current || now - lastAtRef.current < throttleMs) return;
    busyRef.current = true; lastAtRef.current = now;
    try { return await fn(); }
    finally { setTimeout(() => { busyRef.current = false; }, throttleMs); }
  }, [throttleMs]);
  return { guard, busyRef };
}
