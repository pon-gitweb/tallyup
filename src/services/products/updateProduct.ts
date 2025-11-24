// src/services/products/updateProduct.ts
// @ts-nocheck
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Writes BOTH par and supplier fields so the product leaves "unassigned".
 * Call this from the Unassigned UI after validating inputs.
 */
export async function updateProductParAndSupplier(params: {
  venueId: string;
  productId: string;
  par: number;
  supplierId: string;
  supplierName: string;
}) {
  const { venueId, productId, par, supplierId, supplierName } = params;
  if (!par || par <= 0) throw new Error('Par must be a positive number.');
  if (!supplierId || !supplierName) throw new Error('Supplier is required.');

  const db = getFirestore();
  const ref = doc(db, `venues/${venueId}/products/${productId}`);

  await updateDoc(ref, {
    par,
    supplierId,
    supplierName,
    supplier: { id: supplierId, name: supplierName },
    updatedAt: serverTimestamp(),
  });
}
