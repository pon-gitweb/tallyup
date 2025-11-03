export async function withTimeout<T>(p: Promise<T>, ms = 20000, tag = 'op'): Promise<T> {
  let to: any;
  const t = new Promise<never>((_, rej) => {
    to = setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([p, t]); }
  finally { clearTimeout(to); }
}
