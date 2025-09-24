import { useEffect, useState } from 'react';
export default function useDebouncedValue<T>(value: T, delay = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
