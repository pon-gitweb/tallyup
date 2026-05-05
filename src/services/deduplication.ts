/**
 * Deduplication helpers for invoices, sales reports, and stocktake imports.
 * Uses a djb2 hash for fast, dependency-free fingerprinting.
 */
import { Alert } from 'react-native';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// djb2 hash → base-36 string. Deterministic, no dependencies.
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/** Fingerprint for an invoice: supplier + total + date + first 3 line names. */
export function invoiceFingerprint(
  supplierName: string | null | undefined,
  lines: Array<{ name: string; qty?: number; unitPrice?: number }>,
  date?: string | null,
  total?: number | null,
): string {
  const computedTotal = total ??
    lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPrice || 0), 0);
  const key = [
    (supplierName || '').toLowerCase().trim(),
    String(Math.round(computedTotal * 100)),
    (date || '').slice(0, 10),
    lines.slice(0, 3).map(l => l.name.toLowerCase().trim()).join('|'),
  ].join('::');
  return djb2(key);
}

/** Fingerprint for a sales report: date range + line count + first 5 product names. */
export function salesFingerprint(
  lines: Array<{ name?: string | null }>,
  dateRange?: { start?: string | null; end?: string | null },
): string {
  const key = [
    (dateRange?.start || '').slice(0, 10),
    (dateRange?.end || '').slice(0, 10),
    String(lines.length),
    lines.slice(0, 5).map(l => (l.name || '').toLowerCase().trim()).join('|'),
  ].join('::');
  return djb2(key);
}

/** Fingerprint for a stocktake import: product count + first 10 product names. */
export function stocktakeFingerprint(products: Array<{ name: string }>): string {
  const key = [
    String(products.length),
    products.slice(0, 10).map(p => p.name.toLowerCase().trim()).join('|'),
  ].join('::');
  return djb2(key);
}

/** Check if a fingerprint has been processed before. Silent failure → returns not-exists. */
export async function checkProcessed(
  venueId: string,
  collectionName: string,
  hash: string,
): Promise<{ exists: boolean; processedAt: Date | null }> {
  try {
    const db = getFirestore();
    const snap = await getDoc(doc(db, 'venues', venueId, collectionName, hash));
    if (snap.exists()) {
      const d = snap.data() as any;
      const processedAt: Date | null = d?.processedAt?.toDate?.() ?? null;
      return { exists: true, processedAt };
    }
  } catch {}
  return { exists: false, processedAt: null };
}

/** Write a processed fingerprint to Firestore. Silent failure. */
export async function writeProcessed(
  venueId: string,
  collectionName: string,
  hash: string,
  meta: Record<string, any>,
): Promise<void> {
  try {
    const db = getFirestore();
    await setDoc(doc(db, 'venues', venueId, collectionName, hash), {
      ...meta,
      processedAt: serverTimestamp(),
    });
  } catch {}
}

/**
 * Show a "already processed — import anyway?" Alert.
 * Resolves true → user chose "Import anyway".
 * Resolves false → user chose "Skip".
 */
export function confirmDuplicateImport(title: string, message: string): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Skip', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Import anyway', onPress: () => resolve(true) },
    ], { cancelable: false });
  });
}
