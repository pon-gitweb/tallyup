/**
 * Recursively remove any property whose value is undefined.
 *
 * Recurses only into plain objects (prototype === Object.prototype or null)
 * and arrays. Every other object — Date, Firestore Timestamp, serverTimestamp()
 * sentinels, FieldValue, GeoPoint, DocumentReference, class instances — is
 * returned unchanged by identity so write semantics are preserved.
 */
export function stripUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return (obj as unknown as unknown[]).map(stripUndefinedDeep) as unknown as T;
  }
  if (isPlainObject(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) {
        result[k] = stripUndefinedDeep(v);
      }
    }
    return result as T;
  }
  return obj;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
