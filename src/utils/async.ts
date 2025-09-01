export async function tryIt<T>(p: Promise<T>): Promise<[T | null, any | null]> {
  try { return [await p, null]; } catch (e) { return [null, e]; }
}
