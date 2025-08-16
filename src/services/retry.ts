export type RetryOpts = { tries?: number; baseMs?: number; maxMs?: number };

export async function retryWrite<T>(fn: () => Promise<T>, opts: RetryOpts = {}) {
  const tries = opts.tries ?? 4;
  const base  = opts.baseMs ?? 250;
  const cap   = opts.maxMs ?? 2000;

  let lastErr: any = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || '');
      if (!/unavailable|deadline|network|aborted/i.test(msg)) break;
      const delay = Math.min(cap, base * Math.pow(2, i));
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastErr;
}
