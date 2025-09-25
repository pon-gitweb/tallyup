import { getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { setSupplierOnProduct } from './updates';

/**
 * setParSmart: always ensures product doc exists, then writes par/parLevel with merge.
 * This replaces any old updateDoc-based implementation that could hit rules edges.
 */
export async function setParSmart(venueId: string, productId: string, par: number) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const path = `venues/${venueId}/products/${productId}`;

  // Ensure it exists (same as ensureProduct)
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { createdAt: serverTimestamp() }, { merge: true });
  }

  await setDoc(ref, { par: Number(par), parLevel: Number(par), updatedAt: serverTimestamp() }, { merge: true });
  if (__DEV__) console.log('[orders/setParSmart] updated', { venueId, productId, par, path });
}

/**
 * setSupplierSmart: keep here to ensure both fields are set with merge & a stable name.
 */
export async function setSupplierSmart(venueId: string, productId: string, supplierId: string, supplierName?: string | null) {
  await setSupplierOnProduct(venueId, productId, supplierId, supplierName ?? null);
}
