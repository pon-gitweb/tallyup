import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc,
} from 'firebase/firestore';

type LinkResult = {
  productId: string;
  created?: boolean;
};

/**
 * Ensure an area-item is linked to a product:
 *  - try find product by name (best-effort)
 *  - else create a product
 *  - then link the area-item's productId/productRef
 */
export async function linkAreaItemToProduct(
  venueId: string,
  areaItemId: string,
  name?: string | null,
  supplierId?: string | null
): Promise<LinkResult> {
  const db = getFirestore(getApp());

  // 1) try find by exact name
  let productId: string | null = null;
  if (name) {
    try {
      const q = query(collection(db, 'venues', venueId, 'products'), where('name', '==', name));
      const snap = await getDocs(q);
      const first = snap.docs.at(0);
      if (first) productId = first.id;
    } catch {
      // ignore
    }
  }

  // 2) create if not found
  if (!productId) {
    const newId = doc(collection(db, 'venues', venueId, 'products')).id;
    await setDoc(doc(db, 'venues', venueId, 'products', newId), {
      name: name ?? 'Unnamed',
      supplierId: supplierId ?? null,
      createdAt: new Date(),
    }, { merge: true });
    productId = newId;
  }

  // 3) link the area-item (we don’t know dep/area ids; scan shallowly — fine for dev)
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areasSnap.docs) {
      const itemRef = doc(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items', areaItemId);
      const item = await getDoc(itemRef);
      if (item.exists()) {
        await updateDoc(itemRef, {
          productId: productId,
          productRef: doc(db, 'venues', venueId, 'products', productId),
        });
        return { productId, created: true };
      }
    }
  }

  return { productId, created: false };
}

export async function setParOnProduct(venueId: string, productId: string, par: number) {
  const db = getFirestore(getApp());
  await setDoc(doc(db, 'venues', venueId, 'products', productId), {
    par,
    parLevel: par,
  }, { merge: true });
}

export async function setSupplierOnProduct(venueId: string, productId: string, supplierId: string) {
  const db = getFirestore(getApp());
  await setDoc(doc(db, 'venues', venueId, 'products', productId), {
    supplierId,
  }, { merge: true });
}
