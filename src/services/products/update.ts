// @ts-nocheck
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

export async function assignSupplierAndPar({ db = getFirestore(), venueId, productId, supplier, par }) {
  const ref = doc(db, `venues/${venueId}/products/${productId}`);
  const data = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplier: { id: supplier.id, name: supplier.name },
    par,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data, { merge: true });
}
