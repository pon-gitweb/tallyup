import { db } from '../firebase';
import {
  collection, doc, setDoc, addDoc, getDocs, query, where, serverTimestamp,
} from 'firebase/firestore';
import { matchProductInList, VenueProduct } from '../matching';

export type QuickAddProductParams = {
  venueId: string;
  name: string;
  unit?: string | null;
  /** Physical size string (e.g. "750ml") used for recipe costing; null = unsure/unset. */
  size?: string | null;
  supplierName?: string | null;
  barcode?: string | null;
  /** Invoice unit price, persisted as costPrice when creating a new product. */
  costPrice?: number | null;
  category?: string | null;
  brand?: string | null;
  /**
   * Existing venue products to match against.
   * Pass this when the caller already holds the list to avoid a redundant read.
   * Omit to have the function fetch from venues/{venueId}/products.
   */
  existingProducts?: VenueProduct[] | null;
  /**
   * ISO country code of the venue (e.g. 'AU', 'NZ').
   * Used to set gstPercent on new products: AU → 10, everything else → 15.
   * Defaults to NZ (15%) when omitted or null.
   */
  venueCountry?: string | null;
};

export type QuickAddProductResult = {
  productId: string;
  /** true when a new Firestore document was created; false when an existing product matched. */
  isNew: boolean;
  /**
   * Present (and non-null) when isNew is true — the data written to Firestore.
   * Callers can push this into a local product-list cache without an extra read.
   */
  productPayload: {
    id: string;
    name: string;
    unit: string | null;
    supplierName: string | null;
    size: string | null;
    costPrice?: number;
    barcode?: string;
    barcodeNumber?: string;
  } | null;
};

/**
 * Find-or-create a venue product record in venues/{venueId}/products.
 *
 * Behaviour mirrors the product-creation block that was previously inline in
 * StockTakeAreaInventoryScreen's addQuickItem — extracted here so other callers
 * (Accept Order flow, etc.) can reuse the same logic without duplication.
 *
 * - Matches against existingProducts (or fetches if not supplied) via
 *   matchProductInList at confidence ≥ 0.85.
 * - If no reliable match, creates a new product document.
 * - Best-effort: contributes barcoded products to the global_products catalogue.
 * - Best-effort: records partial matches (0.60–0.85) as productMatchCandidates
 *   for manager review.
 *
 * Throws if the Firestore write fails (callers should catch and treat as
 * non-fatal per the established addQuickItem convention).
 */
export async function quickAddProduct(
  params: QuickAddProductParams,
): Promise<QuickAddProductResult> {
  const { venueId, name, unit, size, supplierName, barcode, costPrice, existingProducts, venueCountry, category, brand } = params;

  // Resolve product list — use caller-supplied list to avoid a redundant read.
  let products: VenueProduct[];
  if (existingProducts) {
    products = existingProducts;
  } else {
    const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
    products = snap.docs.map(d => ({ id: d.id, ...(d.data() as VenueProduct) }));
  }

  // Try to match an existing product (threshold 0.85, matching addQuickItem convention).
  const matchResult = matchProductInList(products, { name, barcode: barcode ?? undefined });
  if (matchResult.match && matchResult.confidence >= 0.85) {
    return { productId: matchResult.match.id, isNew: false, productPayload: null };
  }

  // No reliable match — create a new venue product.
  const nowTs = serverTimestamp();
  const newProdRef = doc(collection(db, 'venues', venueId, 'products'));

  const writeData: Record<string, any> = {
    name,
    unit: unit || null,
    supplierName: supplierName || null,
    size: size || null,
    gstPercent: venueCountry === 'AU' ? 10 : 15,
    ...(barcode ? { barcode, barcodeNumber: barcode } : {}),
    ...(costPrice != null && Number.isFinite(costPrice) ? { costPrice } : {}),
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
    createdAt: nowTs,
    updatedAt: nowTs,
  };

  await setDoc(newProdRef, writeData);

  // Best-effort: contribute to global catalogue when a barcode is known.
  if (barcode) {
    try {
      const [g1, g2] = await Promise.all([
        getDocs(query(collection(db, 'global_products'), where('barcode', '==', barcode))),
        getDocs(query(collection(db, 'global_products'), where('barcodeNumber', '==', barcode))),
      ]);
      if (g1.empty && g2.empty) {
        await setDoc(doc(db, 'global_products', barcode), {
          barcode,
          barcodeNumber: barcode,
          name,
          unit: unit || null,
          addedAt: serverTimestamp(),
          addedByVenue: venueId,
          source: 'quick-add',
        }, { merge: true });
      }
    } catch (e: any) {
      console.warn('[quickAddProduct] global catalogue write failed:', e?.message);
    }
  }

  // Best-effort: record partial-match candidate (0.60–0.85) for manager review.
  if (matchResult.match && matchResult.confidence >= 0.6 && matchResult.confidence < 0.85) {
    addDoc(collection(db, 'venues', venueId, 'productMatchCandidates'), {
      newProductId: newProdRef.id,
      newProductName: name,
      candidateProductId: matchResult.match.id,
      candidateProductName: matchResult.match.name,
      confidence: matchResult.confidence,
      source: 'quick-add',
      status: 'pending',
      createdAt: serverTimestamp(),
    }).catch((e: any) => console.warn('[quickAddProduct] candidate match write failed:', e?.message));
  }

  const productPayload = {
    id: newProdRef.id,
    name,
    unit: unit || null,
    supplierName: supplierName || null,
    size: size || null,
    ...(barcode ? { barcode, barcodeNumber: barcode } : {}),
    ...(costPrice != null && Number.isFinite(costPrice) ? { costPrice } : {}),
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
  };

  return { productId: newProdRef.id, isNew: true, productPayload };
}
