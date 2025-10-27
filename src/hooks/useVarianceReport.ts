import { useEffect, useRef, useState } from 'react';
import type { VarianceResult } from '../types/reports';
import { computeVarianceForDepartment } from '../services/reports/variance';

type State = {
  loading: boolean;
  result: VarianceResult | null;
  error: string | null;
};

export function useVarianceReport(venueId: string | null | undefined, departmentId?: string | null) {
  const [state, setState] = useState<State>({ loading: false, result: null, error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!venueId) return;

    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const result = await computeVarianceForDepartment(venueId as string, departmentId ?? null);
        if (!mounted.current || cancelled) return;
        setState({ loading: false, result: (result as any), error: null });
      } catch (e: any) {
        if (!mounted.current || cancelled) return;
        setState({ loading: false, result: null, error: e?.message ?? 'Failed to compute variance' });
      }
    })();

    return () => { cancelled = true; };
  }, [venueId, departmentId]);

  return state;
}
