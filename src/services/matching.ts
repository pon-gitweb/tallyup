// @ts-nocheck
/**
 * Shared product and supplier matching service.
 * Used across all import paths to prevent duplicates.
 *
 * Two layers:
 *   matchProductInList / matchSupplierInList — pure in-memory (no Firestore)
 *   findMatchingProduct / findMatchingSupplier — Firestore-backed convenience wrappers
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VenueProduct = {
  id: string;
  name: string;
  barcode?: string | null;
  brand?: string | null;
  size?: string | null;
  unit?: string | null;
  category?: string | null;
  costPrice?: number | null;
  supplierId?: string | null;
  supplierName?: string | null;
  [key: string]: any;
};

export type MatchedSupplier = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  accountNumber?: string | null;
  [key: string]: any;
};

export type ProductMatchResult = {
  match: VenueProduct | null;
  confidence: number; // 0–1
  matchType: 'exact-barcode' | 'exact-name' | 'fuzzy' | 'none';
  error?: string;
};

export type SupplierMatchResult = {
  match: MatchedSupplier | null;
  confidence: number;
  matchType: 'exact-account' | 'exact-email' | 'exact-phone' | 'exact-name' | 'fuzzy' | 'none';
};

// ─── Core string helpers ──────────────────────────────────────────────────────

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** Token-based Jaccard similarity — 0 (no overlap) to 1 (identical token sets). */
function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter(Boolean));
  const tb = new Set(normName(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

// ─── Pure in-memory matching ──────────────────────────────────────────────────

/**
 * Match a candidate product against a pre-loaded list.
 * Use this when you already have all products to avoid extra Firestore reads.
 */
export function matchProductInList(
  products: VenueProduct[],
  candidate: { name: string; barcode?: string | null },
): ProductMatchResult {
  if (!candidate.name?.trim()) return { match: null, confidence: 0, matchType: 'none' };

  // 1. Exact barcode
  if (candidate.barcode?.trim()) {
    const barcodeMatch = products.find(
      p => p.barcode?.trim() === candidate.barcode!.trim()
    );
    if (barcodeMatch) return { match: barcodeMatch, confidence: 1.0, matchType: 'exact-barcode' };
  }

  // 2. Exact name (case-insensitive, normalised)
  const cn = normName(candidate.name);
  if (cn.length > 2) {
    const exact = products.find(p => normName(p.name) === cn);
    if (exact) return { match: exact, confidence: 1.0, matchType: 'exact-name' };
  }

  // 3. Fuzzy — token Jaccard
  let bestMatch: VenueProduct | null = null;
  let bestScore = 0;
  for (const p of products) {
    const score = tokenJaccard(candidate.name, p.name);
    if (score > bestScore) { bestScore = score; bestMatch = p; }
  }
  if (bestMatch && bestScore >= 0.6) {
    return { match: bestMatch, confidence: bestScore, matchType: 'fuzzy' };
  }

  return { match: null, confidence: 0, matchType: 'none' };
}

/**
 * Match a candidate supplier against a pre-loaded list.
 */
export function matchSupplierInList(
  suppliers: MatchedSupplier[],
  candidate: { name: string; phone?: string | null; email?: string | null; accountNumber?: string | null },
): SupplierMatchResult {
  if (!candidate.name?.trim()) return { match: null, confidence: 0, matchType: 'none' };

  // Normalise phone to digits only (≥7 digits required for a reliable match)
  const normPhone = (s: string | null | undefined) => (s || '').replace(/[^0-9]/g, '');

  for (const s of suppliers) {
    // 1. Exact account number
    if (
      candidate.accountNumber?.trim() &&
      s.accountNumber?.trim() &&
      candidate.accountNumber.trim().toLowerCase() === s.accountNumber.trim().toLowerCase()
    ) {
      return { match: s, confidence: 1.0, matchType: 'exact-account' };
    }
    // 2. Exact email
    if (
      candidate.email?.trim() &&
      s.email?.trim() &&
      candidate.email.trim().toLowerCase() === s.email.trim().toLowerCase()
    ) {
      return { match: s, confidence: 1.0, matchType: 'exact-email' };
    }
    // 3. Exact phone (digits only, ≥7 digits)
    const cp = normPhone(candidate.phone);
    const sp = normPhone(s.phone);
    if (cp.length >= 7 && sp.length >= 7 && cp === sp) {
      return { match: s, confidence: 0.95, matchType: 'exact-phone' };
    }
  }

  // 4. Exact name (case-insensitive)
  const cn = normName(candidate.name);
  if (cn.length > 2) {
    const exact = suppliers.find(s => normName(s.name) === cn);
    if (exact) return { match: exact, confidence: 1.0, matchType: 'exact-name' };
  }

  // 5. Fuzzy name
  let bestMatch: MatchedSupplier | null = null;
  let bestScore = 0;
  for (const s of suppliers) {
    const score = tokenJaccard(candidate.name, s.name);
    if (score > bestScore) { bestScore = score; bestMatch = s; }
  }
  if (bestMatch && bestScore >= 0.6) {
    return { match: bestMatch, confidence: bestScore, matchType: 'fuzzy' };
  }

  return { match: null, confidence: 0, matchType: 'none' };
}

// ─── Firestore-backed wrappers ────────────────────────────────────────────────

/**
 * Load all venue products then run matchProductInList.
 * Use when you don't already have the product list loaded.
 */
export async function findMatchingProduct(
  venueId: string,
  candidate: { name: string; barcode?: string | null; brand?: string | null; size?: string | null },
): Promise<ProductMatchResult> {
  if (!venueId || !candidate.name?.trim()) {
    return { match: null, confidence: 0, matchType: 'none' };
  }
  try {
    const db = getFirestore();

    // Fast-path: exact barcode lookup via query
    // All writers set `barcode`; single-field query is safe — barcodeNumber fallback intentionally omitted here.
    if (candidate.barcode?.trim()) {
      const snap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'products'),
          where('barcode', '==', candidate.barcode.trim()),
        )
      );
      if (!snap.empty) {
        const d = snap.docs[0];
        return { match: { id: d.id, ...(d.data() as any) }, confidence: 1.0, matchType: 'exact-barcode' };
      }
    }

    // Load all products for name matching
    const allSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
    const products: VenueProduct[] = allSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    return matchProductInList(products, candidate);
  } catch (error: any) {
    console.error('[matching] findMatchingProduct failed:', error?.code, error?.message);
    return { match: null, confidence: 0, matchType: 'none', error: error?.message };
  }
}

/**
 * Load all venue suppliers then run matchSupplierInList.
 */
export async function findMatchingSupplier(
  venueId: string,
  candidate: { name: string; phone?: string | null; email?: string | null; accountNumber?: string | null },
): Promise<SupplierMatchResult> {
  if (!venueId || !candidate.name?.trim()) {
    return { match: null, confidence: 0, matchType: 'none' };
  }
  try {
    const db = getFirestore();
    const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
    const suppliers: MatchedSupplier[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    return matchSupplierInList(suppliers, candidate);
  } catch (error: any) {
    console.error('[matching] findMatchingSupplier failed:', error?.code, error?.message);
    return { match: null, confidence: 0, matchType: 'none' };
  }
}
