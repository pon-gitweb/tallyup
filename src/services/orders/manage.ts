import { getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Simple helpers to update product-level data used by the suggestion builder.
 * We update the product doc; the builder re-reads products each time.
 */

export async function setParSmart(venueId: string, productId: string, par: number) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  await setDoc(ref, { par, parLevel: par, updatedAt: serverTimestamp() }, { merge: true });
}

export async function setSupplierSmart(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName?: string
) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  await setDoc(
    ref,
    { supplierId, supplierName: supplierName ?? null, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
