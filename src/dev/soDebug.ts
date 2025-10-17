import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

function safeJSON(x: any) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

/**
 * Log a concise shape of the suggester output.
 * Prints:
 *  - top-level keys
 *  - unassigned.lines length
 *  - one sample supplier bucket id
 *  - one sample line from that bucket
 */
export function logSuggestShape(tag: string, compat: any) {
  const keys = Object.keys(compat || {});
  // accept both shapes: compat.buckets or top-level buckets
  const buckets = (compat && compat.buckets && typeof compat.buckets === 'object')
    ? compat.buckets
    : compat;

  const bucketKeys = Object.keys(buckets || {}).filter(k => k !== 'unassigned');
  const sampleKey = bucketKeys[0] || null;
  const sampleLines = sampleKey
    ? (buckets?.[sampleKey]?.lines || [])
    : [];
  const sampleLine = sampleLines[0] || null;

  const unLen = (compat && compat.unassigned && Array.isArray(compat.unassigned.lines))
    ? compat.unassigned.lines.length
    : 0;

  console.log(`[SO DEBUG] ${tag} keys=`, keys);
  console.log(`[SO DEBUG] ${tag} unassigned.len=`, unLen);
  console.log(`[SO DEBUG] ${tag} sampleBucket.id=`, sampleKey);
  console.log(`[SO DEBUG] ${tag} sampleBucket.lines[0]=`, sampleLine);
}

/**
 * Log one product document (exact field names).
 */
export async function logProductDoc(venueId: string, productId: string) {
  if (!venueId || !productId) {
    console.log('[SO DEBUG] logProductDoc missing venueId or productId', { venueId, productId });
    return;
  }
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.log('[SO DEBUG] product not found', { venueId, productId });
    return;
  }
  console.log('[SO DEBUG] product', productId, safeJSON({ id: snap.id, ...snap.data() }));
}
